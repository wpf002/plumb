import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { restAdapter, status, toCents } from "../src/integrations/sources/rest.js";
import { PHASE2 } from "../src/integrations/sources/vertical.js";

let server: Server;
let base = "";
const seen: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`);
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => res.end(JSON.stringify({ data: { clients: { nodes: [{ id: "g1", name: JSON.parse(body).query.includes("clients") ? "GraphQL Co" : "?" }] } } })));
      return;
    }
    const url = new URL(req.url!, "http://x");
    const page = Number(url.searchParams.get("page") ?? 1);
    res.end(JSON.stringify({ page, total_pages: 2, jobs: [{ id: `job${page}`, description: `Job ${page}`, work_status: page === 1 ? "in progress" : "complete", total_amount: 150000, tenant: url.pathname }] }));
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("restAdapter", () => {
  const spec = (over: object = {}) =>
    restAdapter({
      key: "mock",
      name: "Mock",
      category: "field_service",
      phase: 2,
      credentials: ["token", "tenantId"],
      baseUrl: () => base,
      headers: (c) => ({ Authorization: `Bearer ${c.token}` }),
      resources: [
        {
          kind: "jobs",
          path: "/t/{tenantId}/jobs",
          list: (j) => j.jobs,
          map: (r) => ({ externalId: r.id, name: r.description, status: status(r.work_status), contractCents: r.total_amount, startDate: null, endDate: null }),
          next: (j) => (j.page < j.total_pages ? `/t/{tenantId}/jobs?page=${j.page + 1}` : null),
        },
        { kind: "customers", graphql: true, path: "{ clients { nodes { id name } } }", list: (j) => j.data.clients.nodes, map: (r) => ({ externalId: r.id, name: r.name }) },
      ],
      ...over,
    });

  it("is live only with every credential", () => {
    expect(spec().live({ companyId: "c", credentials: { token: "t" } })).toBe(false);
    expect(spec().live({ companyId: "c", credentials: { token: "t", tenantId: "9" } })).toBe(true);
    expect(spec({ noPublicApi: true }).live({ companyId: "c", credentials: { token: "t", tenantId: "9" } })).toBe(false);
  });

  it("pages, fills placeholders, sends auth, and maps", async () => {
    const b = await spec().fetch({ companyId: "c", credentials: { token: "secret", tenantId: "t 9" } });
    expect(b.jobs?.map((j) => [j.externalId, j.status])).toEqual([["job1", "ACTIVE"], ["job2", "CLOSED"]]);
    expect(b.customers).toEqual([{ externalId: "g1", name: "GraphQL Co" }]);
    expect(seen.some((s) => s.startsWith("GET /t/t%209/jobs?page=2 Bearer secret"))).toBe(true);
  });

  it("previews with a category sample", () => {
    const s = spec().sample({ companyId: "c" });
    expect(s.jobs?.length).toBeGreaterThan(0);
    expect(s.customers?.length).toBeGreaterThan(0);
  });
});

describe("phase 2 catalog", () => {
  it("ships every system on the roadmap, CSV-only where there's no open API", () => {
    const keys = PHASE2.map((a) => a.key);
    for (const k of ["jobber", "servicetitan", "housecallpro", "procore", "buildertrend", "freshbooks", "xero", "adp", "quickbooks_payroll", "paychex", "quickbooks_time", "clockshark", "busybusy", "deputy", "square", "stack", "procore_estimating"]) expect(keys).toContain(k);
    expect(PHASE2.filter((a) => a.csvOnly).map((a) => a.key).sort()).toEqual(["adp", "buildertrend", "clockshark", "paychex", "procore_estimating", "quickbooks_payroll", "stack"]);
  });
  it("parses money and status words", () => {
    expect(toCents("12.345")).toBe(1235);
    expect(status("Scheduled")).toBe("ACTIVE");
    expect(status("Sold")).toBe("AWARDED");
  });
});
