# Plumb API (Fastify). Built from the repo root as context.
FROM node:24-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app
COPY . .

# Dev install so tsc/prisma (devDeps) are available for the build.
RUN NODE_ENV=development pnpm install --frozen-lockfile=false

# Builds shared -> db (prisma generate + tsc) -> engine -> qbo -> api in order.
RUN pnpm --filter @plumb/shared --filter @plumb/engine --filter @plumb/db --filter @plumb/qbo --filter @plumb/api build

# Apply pending migrations before serving, so a deploy can never run new code
# against an old schema. `migrate deploy` only applies committed migrations and
# never resets or drops data on its own.
CMD ["sh", "-c", "pnpm --filter @plumb/db exec prisma migrate deploy && node apps/api/dist/server.js"]
