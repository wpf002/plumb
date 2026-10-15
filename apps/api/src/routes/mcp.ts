import type { FastifyInstance } from "fastify";
import { TOOLS, ToolError, callTool, toolContext, type Scope } from "../tools/index.js";
import type { AuthedRequest } from "./tools.js";

/**
 * Remote MCP server over the tool layer, for the Claude connector and the
 * ChatGPT app. Streamable HTTP transport, JSON responses only (no server-sent
 * events). Authenticated with a DNRD API key; the key fixes the company and
 * the scopes, so a connector sees exactly what the owner granted.
 */

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, any>;
}

const ok = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0" as const, id: id ?? null, result });
const err = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } });

async function handle(msg: RpcRequest, companyId: string, scopes: Scope[], apiKeyId: string): Promise<object | null> {
  // Notifications carry no id and get no response.
  if (msg.id === undefined) return null;
  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      return ok(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "dnrd", title: "DNRD", version: "0.1.0" },
        instructions: "Financial tools for one trade contractor. Every number comes back pre-formatted in facts; quote values exactly and don't compute new ones.",
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, {
        tools: TOOLS.filter((t) => scopes.includes(t.scope)).map((t) => ({
          name: t.name,
          title: t.name.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: t.scope !== "write", destructiveHint: false, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      try {
        const ctx = await toolContext(companyId);
        const r = await callTool(ctx, name, msg.params?.arguments ?? {}, scopes, { caller: "mcp", apiKeyId });
        return ok(msg.id, {
          content: [{ type: "text", text: r.facts.map((f) => `${f.label}: ${f.value}`).join("\n") || "No data." }],
          structuredContent: { facts: r.facts.map(({ key, label, value }) => ({ key, label, value })) },
          isError: false,
        });
      } catch (e) {
        // Unknown tools are protocol errors; failures inside a tool are tool results.
        if (e instanceof ToolError && e.status === 404) return err(msg.id, -32602, e.message);
        return ok(msg.id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    default:
      return err(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export function registerMcpRoutes(app: FastifyInstance) {
  app.post("/mcp", async (req, reply) => {
    const key = (req as AuthedRequest & { apiKeyCompanyId?: string }).apiKey;
    const companyId = (req as AuthedRequest & { apiKeyCompanyId?: string }).apiKeyCompanyId;
    if (!key || !companyId) return reply.code(401).send(err(null, -32001, "A DNRD API key is required."));
    const scopes = key.scopes.filter((s): s is Scope => s === "read" || s === "analyze" || s === "write");
    const body = req.body as RpcRequest | RpcRequest[];
    const batch = Array.isArray(body) ? body : [body];
    if (!batch.length || batch.some((m) => !m || m.jsonrpc !== "2.0" || typeof m.method !== "string")) return reply.code(400).send(err(null, -32600, "Invalid JSON-RPC request."));
    const out = (await Promise.all(batch.map((m) => handle(m, companyId, scopes, key.id)))).filter(Boolean);
    if (!out.length) return reply.code(202).send();
    return reply.header("Content-Type", "application/json").send(Array.isArray(body) ? out : out[0]);
  });
  // No server-initiated stream.
  app.get("/mcp", async (_req, reply) => reply.code(405).header("Allow", "POST").send());
}
