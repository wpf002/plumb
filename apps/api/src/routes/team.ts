import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { prisma } from "@plumb/db";
import { getNotifier } from "../notify.js";

const WEB_URL = process.env.WEB_URL ?? "http://localhost:4200";
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const inviteSchema = {
  type: "object",
  required: ["email"],
  additionalProperties: false,
  properties: {
    email: { type: "string", pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" },
    role: { type: "string", enum: ["OWNER", "MEMBER"] },
  },
} as const;

export function registerTeamRoutes(app: FastifyInstance) {
  // Members + pending invites (any member can view).
  app.get<{ Params: { companyId: string } }>(
    "/companies/:companyId/team",
    async (req) => {
      const [memberships, invites] = await Promise.all([
        prisma.membership.findMany({
          where: { companyId: req.params.companyId },
          include: { user: { select: { id: true, email: true, name: true } } },
          orderBy: { createdAt: "asc" },
        }),
        prisma.invitation.findMany({
          where: { companyId: req.params.companyId, acceptedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      return {
        members: memberships.map((m) => ({ membershipId: m.id, userId: m.user.id, email: m.user.email, name: m.user.name, role: m.role })),
        invites: invites.map((i) => ({ email: i.email, role: i.role, expiresAt: i.expiresAt })),
      };
    }
  );

  // Invite a teammate (OWNER — enforced by the server preHandler).
  app.post<{ Params: { companyId: string }; Body: { email: string; role?: "OWNER" | "MEMBER" } }>(
    "/companies/:companyId/team/invite",
    { schema: { body: inviteSchema } },
    async (req) => {
      const company = await prisma.company.findUniqueOrThrow({ where: { id: req.params.companyId } });
      const email = req.body.email.toLowerCase();
      const token = randomBytes(24).toString("hex");
      const invite = await prisma.invitation.create({
        data: {
          companyId: company.id,
          email,
          role: req.body.role ?? "MEMBER",
          token,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });
      const acceptUrl = `${WEB_URL}/invite?token=${token}`;
      const delivery = await getNotifier().send({
        to: email,
        subject: `You're invited to ${company.name} on DNRD`,
        text: `${company.name} invited you to DNRD as ${invite.role}. Accept: ${acceptUrl}`,
        html: `<p>${company.name} invited you to DNRD as <b>${invite.role}</b>.</p><p><a href="${acceptUrl}">Accept the invitation</a></p>`,
      });
      return { invite: { email, role: invite.role, expiresAt: invite.expiresAt }, acceptUrl, delivery };
    }
  );

  // Remove a member (OWNER). Can't remove the last owner.
  app.delete<{ Params: { companyId: string; membershipId: string } }>(
    "/companies/:companyId/team/:membershipId",
    async (req, reply) => {
      const m = await prisma.membership.findFirst({
        where: { id: req.params.membershipId, companyId: req.params.companyId },
      });
      if (!m) return reply.code(404).send({ error: "Not Found", message: "Member not found." });
      if (m.role === "OWNER") {
        const owners = await prisma.membership.count({ where: { companyId: req.params.companyId, role: "OWNER" } });
        if (owners <= 1) {
          return reply.code(409).send({ error: "Conflict", message: "Can't remove the last owner." });
        }
      }
      await prisma.membership.delete({ where: { id: m.id } });
      return { ok: true };
    }
  );
}
