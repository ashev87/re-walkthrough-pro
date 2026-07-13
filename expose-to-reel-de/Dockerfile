# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Exposé-to-Reel DE — ein Image für BEIDE Dienste (Web + Worker).
# Die Rolle kommt aus E2R_ROLE (docker-entrypoint.sh), da Railway pro Dienst
# keinen Start-Befehl setzen kann:
#   E2R_ROLE=web    (Standard) → prisma migrate deploy + Next-Server auf $PORT
#   E2R_ROLE=worker           → BullMQ-Worker (tsx)
#
# Dev-Dependencies bleiben im Image: der Worker läuft über `tsx` und die
# Migrationen über die `prisma`-CLI — beides sind Root-devDependencies.
# ---------------------------------------------------------------------------
ARG NODE_IMAGE=node:22-bookworm-slim

# --- Basis: Laufzeit-Systempakete (ffmpeg, Python-Bridge, Prisma/OpenSSL) ----
FROM ${NODE_IMAGE} AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-requests \
      ca-certificates \
      openssl \
      fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PYTHON_BIN=python3 \
    FFMPEG_FONT_PATH=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf

# --- Stage 1: Dependencies (npm ci über alle Workspaces) --------------------
FROM base AS deps
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
RUN npm ci --no-audit --no-fund

# --- Stage 2: Build (Prisma-Client + Next-Produktionsbuild) -----------------
FROM base AS build
# NODE_ENV bleibt "production" (aus base) — `next build` erwartet das; die
# devDependencies stammen aus dem deps-Stage und werden hier nicht neu installiert.
# npm hebt alle Workspace-Abhängigkeiten nach /app/node_modules (inkl. der
# Symlinks @e2r/shared → packages/shared).
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema packages/shared/prisma/schema.prisma
# Platzhalterwerte nur für den Build-Prozess (Next lädt Module beim Prerender);
# echte Werte kommen zur Laufzeit aus der Umgebung und landen nicht im Image.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    SESSION_SECRET=build-only-placeholder \
    CREDENTIALS_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
    STORAGE_DRIVER=local \
    npm run build --workspace apps/web

# --- Stage 3: Runtime -------------------------------------------------------
FROM base AS runtime

# node_modules inkl. generiertem Prisma-Client, tsx und prisma-CLI.
COPY --from=build /app/node_modules ./node_modules

# Workspace-Manifeste + tsconfigs (tsx/Next lesen sie zur Laufzeit).
COPY package.json package-lock.json tsconfig.base.json ./
# docker-compose.yml ist der Workspace-Root-Marker von resolveFromWorkspaceRoot()
# und loadRootEnv() — ohne die Datei findet die Web-App die Python-Bridge nicht.
COPY docker-compose.yml ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY apps/web/package.json apps/web/next.config.mjs apps/web/
COPY apps/worker/package.json apps/worker/tsconfig.json apps/worker/

# Quellen: shared + worker laufen über tsx direkt aus src/.
COPY packages/shared/src packages/shared/src
COPY packages/shared/prisma packages/shared/prisma
COPY apps/worker/src apps/worker/src

# Next-Produktionsbuild (schreibbar für den node-User: .next/cache).
COPY --from=build --chown=node:node /app/apps/web/.next apps/web/.next

# Python-Bridge (Propstack-Import) — wird zur Laufzeit gespawnt.
COPY services/propstack services/propstack

# Rollen-Einstiegspunkt: E2R_ROLE=web (Standard, inkl. Migrationen) | worker.
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV PORT=3000 \
    E2R_ROLE=web
EXPOSE 3000
USER node

# Railway kann pro Dienst keinen Start-Befehl setzen — die Rolle steuert E2R_ROLE.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
