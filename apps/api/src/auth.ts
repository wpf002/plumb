import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "@plumb/db";

const scryptAsync = promisify(scrypt);
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const SESSION_COOKIE = "plumb_session";
export const COMPANY_COOKIE = "plumb_company";

/** scrypt hash as "salt:key" hex. Zero-dependency, no plaintext ever stored. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = (await scryptAsync(pw, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [salt, keyHex] = stored.split(":");
  if (!salt || !keyHex) return false;
  const key = Buffer.from(keyHex, "hex");
  const test = (await scryptAsync(pw, salt, 64)) as Buffer;
  return key.length === test.length && timingSafeEqual(key, test);
}

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const s = await prisma.session.create({ data: { userId, expiresAt } });
  return { id: s.id, expiresAt };
}

export async function getSessionUser(
  sessionId?: string
): Promise<{ id: string; email: string; name: string | null } | null> {
  if (!sessionId) return null;
  const s = await prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });
  if (!s || s.expiresAt < new Date()) return null;
  return { id: s.user.id, email: s.user.email, name: s.user.name };
}

export async function isMember(userId: string, companyId: string): Promise<boolean> {
  const m = await prisma.membership.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });
  return Boolean(m);
}
