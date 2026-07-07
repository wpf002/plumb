import { describe, it, expect, vi, afterEach } from "vitest";
import { getPlaid } from "../src/plaid.js";
import { mapFreshbooks } from "../src/integrations/freshbooks.js";
import { nextFourDeadlines } from "../src/integrations/tax.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PLAID_CLIENT_ID;
  delete process.env.PLAID_SECRET;
});

describe("Plaid live client", () => {
  function liveClient() {
    process.env.PLAID_CLIENT_ID = "cid";
    process.env.PLAID_SECRET = "sec";
    const c = getPlaid();
    expect(c.live).toBe(true);
    return c;
  }

  it("sums available depository balances into cents, ignoring other accounts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          accounts: [
            { type: "depository", balances: { available: 1000.5, current: 1100 } },
            { type: "depository", balances: { available: null, current: 250.25 } }, // falls back to current
            { type: "credit", balances: { available: 5000, current: 5000 } }, // ignored
          ],
        }),
      })
    );
    const cents = await liveClient().getBalanceCents("access-tok");
    expect(cents).toBe(125075); // (1000.50 + 250.25) * 100
  });

  it("creates a link token and sends client credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ link_token: "lt-1" }) });
    vi.stubGlobal("fetch", fetchMock);

    const r = await liveClient().createLinkToken("user-9");
    expect(r.linkToken).toBe("lt-1");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.client_id).toBe("cid");
    expect(body.secret).toBe("sec");
    expect(body.user.client_user_id).toBe("user-9");
  });

  it("exchanges a public token for an access token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: "at-1" }) })
    );
    const r = await liveClient().exchangePublicToken("public-1");
    expect(r.accessToken).toBe("at-1");
  });

  it("throws with status + body on a Plaid error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "INVALID_TOKEN" })
    );
    await expect(liveClient().getBalanceCents("bad")).rejects.toThrow(/400.*INVALID_TOKEN/);
  });
});

describe("FreshBooks mapper", () => {
  it("maps invoices to inbound and expenses to outbound events", () => {
    const events = mapFreshbooks(
      [{ id: "1", customer: "ISD", amountCents: 100_00, date: "2026-07-01", paid: false }],
      [{ id: "2", vendor: "Graybar", amountCents: 40_00, date: "2026-07-02" }]
    );
    expect(events).toHaveLength(2);
    const inv = events.find((e) => e.externalId === "FB-INV-1")!;
    expect(inv.direction).toBe("IN");
    expect(inv.status).toBe("EXPECTED");
    const exp = events.find((e) => e.externalId === "FB-EXP-2")!;
    expect(exp.direction).toBe("OUT");
    expect(exp.status).toBe("PAID");
  });

  it("marks a paid invoice RECEIVED", () => {
    const [e] = mapFreshbooks([{ id: "9", customer: "GC", amountCents: 500_00, date: "2026-06-01", paid: true }], []);
    expect(e.status).toBe("RECEIVED");
  });
});

describe("tax deadlines", () => {
  it("returns the next four US estimated-tax dates after asOf", () => {
    const dates = nextFourDeadlines(new Date("2026-07-07T00:00:00Z")).map((d) => d.toISOString().slice(0, 10));
    expect(dates).toEqual(["2026-09-15", "2027-01-15", "2027-04-15", "2027-06-15"]);
  });
});
