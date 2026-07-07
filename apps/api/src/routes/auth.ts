import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "@plumb/db";
import {
  hashPassword,
  verifyPassword,
  createSession,
  getSessionUser,
  SESSION_COOKIE,
  COMPANY_COOKIE,
} from "../auth.js";

const registerSchema = {
  type: "object",
  required: ["email", "password", "companyName"],
  additionalProperties: false,
  properties: {
    email: { type: "string", pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" },
    password: { type: "string", minLength: 8, maxLength: 200 },
    name: { type: "string", maxLength: 120 },
    companyName: { type: "string", minLength: 1, maxLength: 120 },
    trade: { type: "string", maxLength: 60 },
  },
} as const;

const loginSchema = {
  type: "object",
  required: ["email", "password"],
  additionalProperties: false,
  properties: {
    email: { type: "string", minLength: 3 },
    password: { type: "string", minLength: 1 },
  },
} as const;

async function setAuthCookies(reply: FastifyReply, sessionId: string, expiresAt: Date, companyId?: string) {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  if (companyId) {
    // Readable by the web so it knows the active company; not security-sensitive.
    reply.setCookie(COMPANY_COOKIE, companyId, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
  }
}

async function companiesFor(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({ id: m.company.id, name: m.company.name, role: m.role }));
}

export function registerAuthRoutes(app: FastifyInstance) {
  app.post<{ Body: { email: string; password: string; name?: string; companyName: string; trade?: string } }>(
    "/auth/register",
    { schema: { body: registerSchema } },
    async (req, reply) => {
      const email = req.body.email.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return reply.code(409).send({ error: "Conflict", message: "That email is already registered." });

      const user = await prisma.user.create({
        data: { email, name: req.body.name ?? null, passwordHash: await hashPassword(req.body.password) },
      });
      const company = await prisma.company.create({
        data: { name: req.body.companyName, trade: req.body.trade ?? "GENERAL" },
      });
      await prisma.membership.create({ data: { userId: user.id, companyId: company.id, role: "OWNER" } });

      const session = await createSession(user.id);
      await setAuthCookies(reply, session.id, session.expiresAt, company.id);
      return { user: { id: user.id, email: user.email, name: user.name }, companies: await companiesFor(user.id), activeCompanyId: company.id };
    }
  );

  app.post<{ Body: { email: string; password: string } }>(
    "/auth/login",
    { schema: { body: loginSchema } },
    async (req, reply) => {
      const email = req.body.email.toLowerCase();
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !(await verifyPassword(req.body.password, user.passwordHash))) {
        return reply.code(401).send({ error: "Unauthorized", message: "Wrong email or password." });
      }
      const companies = await companiesFor(user.id);
      const session = await createSession(user.id);
      await setAuthCookies(reply, session.id, session.expiresAt, companies[0]?.id);
      return { user: { id: user.id, email: user.email, name: user.name }, companies, activeCompanyId: companies[0]?.id ?? null };
    }
  );

  app.post("/auth/logout", async (req, reply) => {
    const sid = req.cookies[SESSION_COOKIE];
    if (sid) await prisma.session.deleteMany({ where: { id: sid } });
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.clearCookie(COMPANY_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", async (req, reply) => {
    const user = await getSessionUser(req.cookies[SESSION_COOKIE]);
    if (!user) return reply.code(401).send({ error: "Unauthorized", message: "Not signed in." });
    const companies = await companiesFor(user.id);
    const cookieCompany = req.cookies[COMPANY_COOKIE];
    const activeCompanyId = companies.some((c) => c.id === cookieCompany)
      ? cookieCompany
      : companies[0]?.id ?? null;
    return { user, companies, activeCompanyId };
  });

  // Switch the active company (must be a member).
  app.post<{ Body: { companyId: string } }>(
    "/auth/active-company",
    {
      schema: {
        body: { type: "object", required: ["companyId"], additionalProperties: false, properties: { companyId: { type: "string" } } },
      },
    },
    async (req, reply) => {
      const user = await getSessionUser(req.cookies[SESSION_COOKIE]);
      if (!user) return reply.code(401).send({ error: "Unauthorized", message: "Not signed in." });
      const companies = await companiesFor(user.id);
      if (!companies.some((c) => c.id === req.body.companyId)) {
        return reply.code(403).send({ error: "Forbidden", message: "Not a member of that company." });
      }
      reply.setCookie(COMPANY_COOKIE, req.body.companyId, { httpOnly: false, sameSite: "lax", path: "/" });
      return { activeCompanyId: req.body.companyId };
    }
  );
}
