# Plumb web (Next.js). Built from the repo root as context.
FROM node:24-slim

RUN corepack enable
WORKDIR /app
COPY . .

RUN NODE_ENV=development pnpm install --frozen-lockfile=false

# Client code calls the API at /api (same origin); Next rewrites /api to the
# private API service. Next bakes rewrites() at build time, so INTERNAL_API_URL
# must be present now — default it to the API's stable Railway private address.
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG INTERNAL_API_URL=http://plumb-api.railway.internal:4300
ENV INTERNAL_API_URL=$INTERNAL_API_URL

RUN pnpm --filter @plumb/web build

# Railway assigns $PORT; Next binds 0.0.0.0 by default.
CMD ["sh", "-c", "pnpm --filter @plumb/web exec next start -p ${PORT:-4200}"]
