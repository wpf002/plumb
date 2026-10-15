import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Integration credentials are encrypted at rest with AES-256-GCM. The key is
 * derived from PLUMB_SECRET_KEY; without it, per-company credentials can't be
 * stored and only install-wide environment tokens work.
 */

const key = () => {
  const raw = process.env.PLUMB_SECRET_KEY;
  return raw ? createHash("sha256").update(raw).digest() : null;
};

export const canStoreSecrets = () => key() !== null;

export function seal(value: Record<string, string>): string {
  const k = key();
  if (!k) throw new Error("PLUMB_SECRET_KEY is not set; credentials can't be stored.");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function unseal(sealed: string | null | undefined): Record<string, string> | null {
  const k = key();
  if (!sealed || !k) return null;
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", k, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString("utf8"));
}
