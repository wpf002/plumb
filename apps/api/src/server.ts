import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { registerAuthRoutes } from "./routes/auth.js";
import { getSessionUser, getMemberRole, SESSION_COOKIE } from "./auth.js";

// Routes only an OWNER may call (company config + team). Everything else a MEMBER
// can do. The regex is matched against the path (without query string).
const VIEWER_COMPUTE: RegExp[] = [
  /^\/companies\/[^/]+\/denny$/,
  /^\/companies\/[^/]+\/what-if$/,
  /^\/companies\/[^/]+\/capital\/(purchase|repair-replace|hire|crew)$/,
  /^\/companies\/[^/]+\/sources\/[^/]+\/preview$/,
  /^\/companies\/[^/]+\/tools\/[^/]+$/,
];

const OWNER_ONLY: { method: string; re: RegExp }[] = [
  { method: "PUT", re: /^\/companies\/[^/]+\/settings$/ },
  { method: "POST", re: /^\/companies\/[^/]+\/opening-cash/ },
  { method: "PUT", re: /^\/companies\/[^/]+\/category-mappings$/ },
  { method: "POST", re: /^\/companies\/[^/]+\/team\// },
  { method: "DELETE", re: /^\/companies\/[^/]+\/team\// },
  { method: "POST", re: /^\/companies\/[^/]+\/import$/ },
  { method: "POST", re: /^\/companies\/[^/]+\/api-keys$/ },
  { method: "DELETE", re: /^\/companies\/[^/]+\/api-keys\// },
  { method: "POST", re: /^\/companies\/[^/]+\/sources\/[^/]+\/sync$/ },
  { method: "PUT", re: /^\/companies\/[^/]+\/plan$/ },
  { method: "PUT", re: /^\/companies\/[^/]+\/sources\/[^/]+\/connection$/ },
  { method: "DELETE", re: /^\/companies\/[^/]+\/sources\/[^/]+\/connection$/ },
];
import { registerForecastRoutes } from "./routes/forecast.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerBidRoutes } from "./routes/bid.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerWipRoutes } from "./routes/wip.js";
import { registerQboRoutes } from "./routes/qbo.js";
import { registerDigestRoutes } from "./routes/digest.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerIntegrationRoutes } from "./routes/integrations.js";
import { registerChangeOrderRoutes } from "./routes/changeorders.js";
import { registerTeamRoutes } from "./routes/team.js";
import { registerConnectionRoutes } from "./routes/connections.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerLiabilityRoutes } from "./routes/liabilities.js";
import { registerBalanceSheetRoutes } from "./routes/balancesheet.js";
import { registerRecurringRoutes } from "./routes/recurring.js";
import { registerMilestoneRoutes } from "./routes/milestones.js";
import { registerPayerRoutes } from "./routes/payers.js";
import { registerScenarioRoutes } from "./routes/scenarios.js";
import { registerServiceRoutes } from "./routes/services.js";
import { registerAnalysisRoutes } from "./routes/analysis.js";
import { registerTrustRoutes } from "./routes/trust.js";
import { registerImportRoutes } from "./routes/imports.js";
import { registerStatementRoutes, registerTaxRoutes } from "./routes/statements.js";
import { registerWorkingCapitalRoutes } from "./routes/workingcapital.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerBenchmarkRoutes, registerOperationsRoutes } from "./routes/operations.js";
import { registerCapitalRoutes, registerScenarioV2Routes } from "./routes/capital.js";
import { registerDennyRoutes } from "./routes/denny.js";
import { apiKeyFor, registerToolRoutes, type AuthedRequest } from "./routes/tools.js";
import { registerSourceRoutes } from "./routes/sources.js";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerBusinessRoutes } from "./routes/business.js";
import { featureForRoute, requireFeature } from "./plan.js";
import { registerPlanRoutes } from "./routes/plan.js";
import { registerForecastV2Routes } from "./routes/forecasts.js";
import { startScheduler } from "./scheduler.js";

export function buildServer() {
  const app = Fastify({ logger: true });
  // Credentials so the browser sends the session cookie cross-port (same-site).
  app.register(cors, { origin: true, credentials: true, exposedHeaders: ["Content-Disposition"] });
  app.register(cookie);

  // Auth gate: everything except /healthz, /auth/*, and the QBO OAuth callback
  // requires a session; company-scoped routes additionally require membership.
  app.addHook("preHandler", async (req, reply) => {
    const path = req.url.split("?")[0];
    if (path === "/healthz" || path.startsWith("/auth/") || path.startsWith("/qbo/callback")) return;

    // API keys reach the tool API and nothing else.
    const bearer = req.headers.authorization?.match(/^Bearer (plb_[A-Za-z0-9_-]+)$/)?.[1];
    if (bearer) {
      const tm = path.match(/^\/companies\/([^/]+)\/tools(\/|$)/);
      const isMcp = path === "/mcp";
      const key = tm || isMcp ? await apiKeyFor(bearer) : null;
      if (!key || (tm && key.companyId !== tm[1]) || (!tm && !isMcp)) return reply.code(401).send({ error: "Unauthorized", message: "Invalid API key for this route." });
      const blocked = await requireFeature(key.companyId, "api");
      if (blocked) return reply.code(403).send(blocked);
      (req as AuthedRequest).apiKey = { id: key.id, scopes: key.scopes };
      (req as AuthedRequest & { apiKeyCompanyId?: string }).apiKeyCompanyId = key.companyId;
      return;
    }
    if (path === "/mcp") return reply.code(401).send({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "A DNRD API key is required." } });

    const user = await getSessionUser(req.cookies[SESSION_COOKIE]);
    if (!user) return reply.code(401).send({ error: "Unauthorized", message: "Sign in required." });
    (req as AuthedRequest).userId = user.id;

    const m = path.match(/^\/companies\/([^/]+)/);
    if (m) {
      const role = await getMemberRole(user.id, m[1]);
      if (!role) {
        return reply.code(403).send({ error: "Forbidden", message: "Not a member of this company." });
      }
      (req as AuthedRequest).memberRole = role;
      // Viewers read. The only requests they can send are ones that compute without saving.
      if (role === "VIEWER" && req.method !== "GET" && !VIEWER_COMPUTE.some((re) => re.test(path))) {
        return reply.code(403).send({ error: "Forbidden", message: "View-only access." });
      }
      const feature = featureForRoute(req.method, path);
      if (feature) {
        const blocked = await requireFeature(m[1], feature);
        if (blocked) return reply.code(403).send(blocked);
      }
      const ownerOnly = OWNER_ONLY.some((r) => r.method === req.method && r.re.test(path));
      if (ownerOnly && role !== "OWNER") {
        return reply.code(403).send({ error: "Forbidden", message: "Owner permission required." });
      }
    }
  });

  // Uniform error shape. Prisma's findUniqueOrThrow raises P2025 when a company
  // or record is missing — surface that as a clean 404 rather than a 500.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err.validation) {
      return reply
        .status(400)
        .send({ error: "Bad Request", message: err.message });
    }
    if (err.code === "P2025") {
      return reply
        .status(404)
        .send({ error: "Not Found", message: "Company or record not found." });
    }
    const status =
      typeof err.statusCode === "number" && err.statusCode >= 400
        ? err.statusCode
        : 500;
    if (status >= 500) req.log.error(err);
    return reply.status(status).send({
      error: status === 500 ? "Internal Server Error" : err.name,
      message: status === 500 ? "Something went wrong." : err.message,
    });
  });

  app.get("/healthz", async () => ({ ok: true }));

  registerAuthRoutes(app);
  registerHealthRoutes(app);
  registerForecastRoutes(app);
  registerProjectRoutes(app);
  registerBidRoutes(app);
  registerWipRoutes(app);
  registerQboRoutes(app);
  registerDigestRoutes(app);
  registerSettingsRoutes(app);
  registerIntegrationRoutes(app);
  registerChangeOrderRoutes(app);
  registerTeamRoutes(app);
  registerConnectionRoutes(app);
  registerAssetRoutes(app);
  registerLiabilityRoutes(app);
  registerBalanceSheetRoutes(app);
  registerRecurringRoutes(app);
  registerMilestoneRoutes(app);
  registerPayerRoutes(app);
  registerScenarioRoutes(app);
  registerServiceRoutes(app);
  registerAnalysisRoutes(app);
  registerTrustRoutes(app);
  registerImportRoutes(app);
  registerStatementRoutes(app);
  registerTaxRoutes(app);
  registerWorkingCapitalRoutes(app);
  registerJobRoutes(app);
  registerOperationsRoutes(app);
  registerBenchmarkRoutes(app);
  registerCapitalRoutes(app);
  registerScenarioV2Routes(app);
  registerDennyRoutes(app);
  registerToolRoutes(app);
  registerSourceRoutes(app);
  registerMcpRoutes(app);
  registerBusinessRoutes(app);
  registerPlanRoutes(app);
  registerForecastV2Routes(app);

  return app;
}

const port = Number(process.env.PORT ?? 4300);
const app = buildServer();
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    console.log(`plumb-api on :${port}`);
    startScheduler(app.log);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
