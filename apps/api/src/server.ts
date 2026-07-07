import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { registerAuthRoutes } from "./routes/auth.js";
import { getSessionUser, getMemberRole, SESSION_COOKIE } from "./auth.js";

// Routes only an OWNER may call (company config + team). Everything else a MEMBER
// can do. The regex is matched against the path (without query string).
const OWNER_ONLY: { method: string; re: RegExp }[] = [
  { method: "PUT", re: /^\/companies\/[^/]+\/settings$/ },
  { method: "POST", re: /^\/companies\/[^/]+\/opening-cash/ },
  { method: "PUT", re: /^\/companies\/[^/]+\/category-mappings$/ },
  { method: "POST", re: /^\/companies\/[^/]+\/team\// },
  { method: "DELETE", re: /^\/companies\/[^/]+\/team\// },
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
import { startScheduler } from "./scheduler.js";

export function buildServer() {
  const app = Fastify({ logger: true });
  // Credentials so the browser sends the session cookie cross-port (same-site).
  app.register(cors, { origin: true, credentials: true });
  app.register(cookie);

  // Auth gate: everything except /healthz, /auth/*, and the QBO OAuth callback
  // requires a session; company-scoped routes additionally require membership.
  app.addHook("preHandler", async (req, reply) => {
    const path = req.url.split("?")[0];
    if (path === "/healthz" || path.startsWith("/auth/") || path.startsWith("/qbo/callback")) return;

    const user = await getSessionUser(req.cookies[SESSION_COOKIE]);
    if (!user) return reply.code(401).send({ error: "Unauthorized", message: "Sign in required." });

    const m = path.match(/^\/companies\/([^/]+)/);
    if (m) {
      const role = await getMemberRole(user.id, m[1]);
      if (!role) {
        return reply.code(403).send({ error: "Forbidden", message: "Not a member of this company." });
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
