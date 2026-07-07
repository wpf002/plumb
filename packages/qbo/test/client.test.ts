import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QboClient } from "../src/client.js";
import * as oauth from "../src/oauth.js";

const future = () => new Date(Date.now() + 3_600_000);
const past = () => new Date(Date.now() - 1_000);

function client(expiresAt: Date) {
  return new QboClient({
    realmId: "realm1",
    environment: "sandbox",
    tokens: { accessToken: "tok", refreshToken: "ref", expiresAt },
  });
}

describe("QboClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pages through query results until a short page", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => ({ Id: String(i) }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ QueryResponse: { Invoice: page1 } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ QueryResponse: { Invoice: [{ Id: "500" }] } }) });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await client(future()).query<{ Id: string }>("Invoice");
    expect(rows).toHaveLength(501);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Second call advances STARTPOSITION.
    expect(decodeURIComponent(fetchMock.mock.calls[1][0])).toContain("STARTPOSITION 501");
  });

  it("throws with status + body on a failed query", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" })
    );
    await expect(client(future()).query("Invoice")).rejects.toThrow(/401 unauthorized/);
  });

  it("posts an invoice with the right method/url and parses the id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Invoice: { Id: "42" } }) });
    vi.stubGlobal("fetch", fetchMock);

    const res = await client(future()).createInvoice({ Line: [{ Amount: 100 }] });
    expect(res.id).toBe("42");

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/v3/company/realm1/invoice");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(opts.body)).toEqual({ Line: [{ Amount: 100 }] });
  });

  it("refreshes an expired token before calling, and persists it", async () => {
    const onTokenRefresh = vi.fn();
    const refreshed = { accessToken: "tok2", refreshToken: "ref2", expiresAt: future() };
    vi.spyOn(oauth, "refresh").mockResolvedValue(refreshed);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ QueryResponse: { Invoice: [] } }) });
    vi.stubGlobal("fetch", fetchMock);

    const c = new QboClient({
      realmId: "realm1",
      environment: "sandbox",
      tokens: { accessToken: "tok", refreshToken: "ref", expiresAt: past() },
      onTokenRefresh,
    });
    await c.query("Invoice");

    expect(oauth.refresh).toHaveBeenCalledWith("ref");
    expect(onTokenRefresh).toHaveBeenCalledWith(refreshed);
    // Subsequent request uses the new access token.
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok2");
  });
});
