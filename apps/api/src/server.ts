import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import { registerForecastRoutes } from "./routes/forecast.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerBidRoutes } from "./routes/bid.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerWipRoutes } from "./routes/wip.js";
import { registerQboRoutes } from "./routes/qbo.js";

export function buildServer() {
  const app = Fastify({ logger: true });
  app.register(cors, { origin: true });

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

  registerHealthRoutes(app);
  registerForecastRoutes(app);
  registerProjectRoutes(app);
  registerBidRoutes(app);
  registerWipRoutes(app);
  registerQboRoutes(app);

  return app;
}

const port = Number(process.env.PORT ?? 4300);
buildServer()
  .listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`plumb-api on :${port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
