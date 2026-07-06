import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerForecastRoutes } from "./routes/forecast.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerBidRoutes } from "./routes/bid.js";
import { registerHealthRoutes } from "./routes/health.js";

export function buildServer() {
  const app = Fastify({ logger: true });
  app.register(cors, { origin: true });

  app.get("/healthz", async () => ({ ok: true }));

  registerHealthRoutes(app);
  registerForecastRoutes(app);
  registerProjectRoutes(app);
  registerBidRoutes(app);

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
