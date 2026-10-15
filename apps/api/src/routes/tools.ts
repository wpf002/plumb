import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@plumb/db";
import { SCOPES_BY_ROLE, TOOLS, ToolError, callTool, toolContext, type Scope } from "../tools/index.js";

/**
 * The internal tool API. Signed-in members call it with their role's scopes;
 * API keys call it with the scopes the owner granted. The same tools back Ask
 * Denny and, later, external AI connectors.
 */

export type AuthedRequest = FastifyRequest & { userId?: string; memberRole?: string; apiKey?: { id: string; scopes: string[] } };

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export async function apiKeyFor(key: string) {
  const k = await prisma.apiKey.findUnique({ where: { hash: hash(key) } });
  if (!k || k.revokedAt) return null;
  await prisma.apiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return k;
}

function scopesOf(req: AuthedRequest): Scope[] {
  if (req.apiKey) return req.apiKey.scopes.filter((s): s is Scope => s === "read" || s === "analyze" || s === "write");
  return SCOPES_BY_ROLE[req.memberRole ?? "MEMBER"] ?? ["read"];
}

type P = { Params: { companyId: string } };

export function registerToolRoutes(app: FastifyInstance) {
  app.get<P>("/companies/:companyId/tools", async (req) => {
    const scopes = scopesOf(req as AuthedRequest);
    return {
      scopes,
      tools: TOOLS.filter((t) => scopes.includes(t.scope)).map((t) => ({ name: t.name, description: t.description, scope: t.scope, inputSchema: t.inputSchema })),
    };
  });

  app.post<P & { Params: { name: string }; Body: Record<string, unknown> | undefined }>("/companies/:companyId/tools/:name", async (req, reply) => {
    const r = req as AuthedRequest;
    try {
      const ctx = await toolContext(req.params.companyId);
      const result = await callTool(ctx, req.params.name, (req.body ?? {}) as Record<string, unknown>, scopesOf(r), {
        caller: r.apiKey ? "api" : "app",
        userId: r.userId,
        apiKeyId: r.apiKey?.id,
      });
      return { tool: req.params.name, facts: result.facts };
    } catch (e) {
      if (e instanceof ToolError) return reply.code(e.status).send({ error: e.status === 403 ? "Forbidden" : "Not Found", message: e.message });
      return reply.code(422).send({ error: "Unprocessable", message: e instanceof Error ? e.message : String(e) });
    }
  });

  // ---- API keys (owner only; see OWNER_ONLY in server.ts) ----
  app.get<P>("/companies/:companyId/api-keys", async (req) => {
    const keys = await prisma.apiKey.findMany({ where: { companyId: req.params.companyId }, orderBy: { createdAt: "desc" } });
    return keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt, createdAt: k.createdAt }));
  });

  app.post<P & { Body: { name: string; scopes: Scope[] } }>(
    "/companies/:companyId/api-keys",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "scopes"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80 },
            scopes: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", enum: ["read", "analyze", "write"] } },
          },
        },
      },
    },
    async (req, reply) => {
      const key = `plb_${randomBytes(24).toString("base64url")}`;
      const k = await prisma.apiKey.create({
        data: { companyId: req.params.companyId, name: req.body.name, prefix: key.slice(0, 10), hash: hash(key), scopes: req.body.scopes, createdById: (req as AuthedRequest).userId ?? null },
      });
      // The only time the full key is returned.
      return reply.code(201).send({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, key });
    }
  );

  app.delete<P & { Params: { keyId: string } }>("/companies/:companyId/api-keys/:keyId", async (req) => {
    await prisma.apiKey.update({ where: { id: req.params.keyId, companyId: req.params.companyId }, data: { revokedAt: new Date() } });
    return { ok: true };
  });

  app.get<P>("/companies/:companyId/tool-calls", async (req) => {
    const calls = await prisma.toolCallLog.findMany({ where: { companyId: req.params.companyId }, orderBy: { createdAt: "desc" }, take: 50 });
    return calls;
  });
}
