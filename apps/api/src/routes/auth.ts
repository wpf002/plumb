import type { FastifyInstance, FastifyReply } from "fastify";
import { randomBytes } from "node:crypto";
import { prisma } from "@plumb/db";
import {
  hashPassword,
  verifyPassword,
  createSession,
  getSessionUser,
  SESSION_COOKIE,
  COMPANY_COOKIE,
} from "../auth.js";
import { getNotifier } from "../notify.js";
import { TRADES, REVENUE_MODELS } from "./settings.js";

const WEB_URL = process.env.WEB_URL ?? "http://localhost:4200";
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

const registerSchema = {
  type: "object",
  required: ["email", "password", "companyName"],
  additionalProperties: false,
  properties: {
    email: { type: "string", pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" },
    password: { type: "string", minLength: 8, maxLength: 200 },
    name: { type: "string", maxLength: 120 },
    companyName: { type: "string", minLength: 1, maxLength: 120 },
    trade: { type: "string", enum: [...TRADES] },
    employeeCount: { type: "integer", minimum: 0, maximum: 100000 },
    revenueModel: { type: "string", enum: [...REVENUE_MODELS] },
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
    include: {
      company: {
        select: {
          id: true,
          name: true,
          trade: true,
          employeeCount: true,
          revenueModel: true,
          setupCompletedAt: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  // The web gates nav and dashboard sections on revenueModel, and bounces to the
  // setup wizard when setupCompletedAt is null — so both travel with /auth/me.
  return memberships.map((m) => ({ ...m.company, role: m.role }));
}

export function registerAuthRoutes(app: FastifyInstance) {
  app.post<{
    Body: {
      email: string;
      password: string;
      name?: string;
      companyName: string;
      trade?: (typeof TRADES)[number];
      employeeCount?: number;
      revenueModel?: (typeof REVENUE_MODELS)[number];
    };
  }>(
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
        data: {
          name: req.body.companyName,
          trade: req.body.trade ?? "GENERAL",
          employeeCount: req.body.employeeCount ?? 0,
          revenueModel: req.body.revenueModel ?? "BOTH",
        },
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

  // Preview an invitation (public) so the accept page can render.
  app.get<{ Params: { token: string } }>("/auth/invite/:token", async (req, reply) => {
    const invite = await prisma.invitation.findUnique({
      where: { token: req.params.token },
      include: { company: { select: { name: true } } },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      return reply.code(404).send({ error: "Not Found", message: "This invitation is invalid or expired." });
    }
    const existing = await prisma.user.findUnique({ where: { email: invite.email } });
    return { email: invite.email, companyName: invite.company.name, role: invite.role, needsPassword: !existing };
  });

  // Accept an invitation (public): join the company, creating an account if new.
  app.post<{ Body: { token: string; name?: string; password?: string } }>(
    "/auth/accept-invite",
    {
      schema: {
        body: {
          type: "object",
          required: ["token"],
          additionalProperties: false,
          properties: { token: { type: "string" }, name: { type: "string", maxLength: 120 }, password: { type: "string", maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const invite = await prisma.invitation.findUnique({ where: { token: req.body.token } });
      if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
        return reply.code(400).send({ error: "Bad Request", message: "This invitation is invalid or expired." });
      }
      let user = await prisma.user.findUnique({ where: { email: invite.email } });
      if (!user) {
        if (!req.body.password || req.body.password.length < 8) {
          return reply.code(400).send({ error: "Bad Request", message: "Choose a password (8+ characters) to accept." });
        }
        user = await prisma.user.create({
          data: { email: invite.email, name: req.body.name ?? null, passwordHash: await hashPassword(req.body.password) },
        });
      }
      await prisma.membership.upsert({
        where: { userId_companyId: { userId: user.id, companyId: invite.companyId } },
        update: {},
        create: { userId: user.id, companyId: invite.companyId, role: invite.role },
      });
      await prisma.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });

      const companies = await companiesFor(user.id);
      const session = await createSession(user.id);
      await setAuthCookies(reply, session.id, session.expiresAt, invite.companyId);
      return { user: { id: user.id, email: user.email, name: user.name }, companies, activeCompanyId: invite.companyId };
    }
  );

  // Request a password reset (public). Never reveals whether the email exists;
  // without an email provider it returns the link so the demo flow still works.
  app.post<{ Body: { email: string } }>(
    "/auth/request-reset",
    { schema: { body: { type: "object", required: ["email"], additionalProperties: false, properties: { email: { type: "string", minLength: 3 } } } } },
    async (req) => {
      const email = req.body.email.toLowerCase();
      const user = await prisma.user.findUnique({ where: { email } });
      let resetUrl: string | undefined;
      if (user) {
        const token = randomBytes(24).toString("hex");
        await prisma.passwordResetToken.create({
          data: { userId: user.id, token, expiresAt: new Date(Date.now() + RESET_TTL_MS) },
        });
        const url = `${WEB_URL}/reset?token=${token}`;
        const delivery = await getNotifier().send({
          to: email,
          subject: "Reset your Plumb password",
          text: `Reset your password: ${url}`,
          html: `<p><a href="${url}">Reset your Plumb password</a> (expires in 1 hour).</p>`,
        });
        if (!delivery.delivered) resetUrl = url; // dry-run: surface the link
      }
      return { ok: true, ...(resetUrl ? { resetUrl } : {}) };
    }
  );

  // Validate a reset token (public).
  app.get<{ Params: { token: string } }>("/auth/reset/:token", async (req, reply) => {
    const t = await prisma.passwordResetToken.findUnique({ where: { token: req.params.token }, include: { user: true } });
    if (!t || t.usedAt || t.expiresAt < new Date()) {
      return reply.code(404).send({ error: "Not Found", message: "This reset link is invalid or expired." });
    }
    return { email: t.user.email };
  });

  // Set a new password (public). Invalidates the token and all sessions.
  app.post<{ Body: { token: string; password: string } }>(
    "/auth/reset",
    { schema: { body: { type: "object", required: ["token", "password"], additionalProperties: false, properties: { token: { type: "string" }, password: { type: "string", minLength: 8, maxLength: 200 } } } } },
    async (req, reply) => {
      const t = await prisma.passwordResetToken.findUnique({ where: { token: req.body.token } });
      if (!t || t.usedAt || t.expiresAt < new Date()) {
        return reply.code(400).send({ error: "Bad Request", message: "This reset link is invalid or expired." });
      }
      await prisma.$transaction([
        prisma.user.update({ where: { id: t.userId }, data: { passwordHash: await hashPassword(req.body.password) } }),
        prisma.passwordResetToken.update({ where: { id: t.id }, data: { usedAt: new Date() } }),
        prisma.session.deleteMany({ where: { userId: t.userId } }),
      ]);
      return { ok: true };
    }
  );

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
