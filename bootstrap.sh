#!/usr/bin/env bash
# Plumb infrastructure bootstrap. Idempotent. Run from repo root.
set -euo pipefail

say() { printf "\033[1;36m==>\033[0m %s\n" "$1"; }
warn() { printf "\033[1;33m!!\033[0m %s\n" "$1"; }

# --- 0. Toolchain ------------------------------------------------------------
say "Checking toolchain"
command -v node >/dev/null || { warn "node not found (need >=20)"; exit 1; }
command -v pnpm >/dev/null || { warn "pnpm not found -> 'corepack enable && corepack prepare pnpm@9.12.0 --activate'"; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
  || { warn "Node >=20 required"; exit 1; }

# --- 1. Folder structure (idempotent; repo already ships these) --------------
say "Ensuring folder structure"
mkdir -p apps/web/src/app apps/api/src/routes \
         packages/db/prisma packages/db/src \
         packages/engine/src packages/engine/test \
         packages/qbo/src \
         packages/shared/src

# --- 2. Environment ----------------------------------------------------------
if [ ! -f .env ]; then
  say "Creating .env from .env.example"
  cp .env.example .env
else
  say ".env already present — leaving it alone"
fi

# --- 3. Local Postgres (optional) --------------------------------------------
if command -v docker >/dev/null; then
  if ! docker ps --format '{{.Names}}' | grep -q '^plumb-pg$'; then
    say "Starting local Postgres (docker: plumb-pg on :5432)"
    docker run -d --name plumb-pg \
      -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=plumb \
      -p 5432:5432 postgres:16 >/dev/null
    sleep 3
  else
    say "Postgres container plumb-pg already running"
  fi
else
  warn "docker not found — point DATABASE_URL at Railway or an existing Postgres"
fi

# --- 4. Dependencies ---------------------------------------------------------
say "Installing dependencies"
pnpm install

# --- 5. Database -------------------------------------------------------------
say "Generating Prisma client + pushing schema"
pnpm --filter @plumb/db exec prisma generate
pnpm --filter @plumb/db exec prisma migrate deploy

say "Seeding demo data (Foley Electric reference profile)"
pnpm --filter @plumb/db exec tsx prisma/seed.ts

echo
say "Done. Next:"
echo "  1. Copy the seeded company id printed above into NEXT_PUBLIC_COMPANY_ID in .env"
echo "  2. pnpm --filter @plumb/api dev      # API on :4300"
echo "  3. pnpm --filter @plumb/web dev      # dashboard on :4200"
echo "  4. pnpm --filter @plumb/engine test  # verify engine math"
