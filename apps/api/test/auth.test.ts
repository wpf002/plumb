import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth.js";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("plumb1234");
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/); // salt:key hex
    expect(await verifyPassword("plumb1234", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("produces a unique salt per hash", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b); // different salts
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("rejects malformed stored hashes without throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "nosalt")).toBe(false);
  });
});
