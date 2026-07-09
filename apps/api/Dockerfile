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

# A throwaway URL lets `prisma generate` load prisma.config.ts at build time;
# the real DATABASE_URL is injected by Railway at runtime.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
  pnpm --filter @plumb/db exec prisma generate

RUN pnpm --filter @plumb/shared --filter @plumb/engine --filter @plumb/db --filter @plumb/qbo --filter @plumb/api build

CMD ["node", "apps/api/dist/server.js"]
