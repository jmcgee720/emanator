# ──────────────────────────────────────────────────────────────────────
# Auroraly Preview Runner
# ──────────────────────────────────────────────────────────────────────
# This is the per-machine Docker image that runs INSIDE Fly Machines.
# Each user-imported project (Mangia-Mama, Dopples, Spyrals, etc.) runs
# its dev server inside a fresh container of this image.
#
# Image responsibilities:
#   1. Run the small "runner" Node service (./index.js) on internal :8080
#   2. The runner accepts file syncs + spawns `npm run dev` for the user
#   3. The user's dev server is the one Fly's edge exposes externally on :3000
#
# Kept deliberately fat so we don't have to npm-install build tools per
# project: yarn, pnpm, git, python (some npm postinstalls need it),
# common image libs, tini for proper signal handling.
# ──────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim

# tini = proper PID 1 so SIGTERM reaches the user's dev server cleanly
# git  = some user projects fetch deps from git urls
# python3/build-essential = node-gyp fallbacks (sharp, sqlite3, etc.)
# curl = healthchecks + the runner uses fetch internally
RUN apt-get update && apt-get install -y --no-install-recommends \
        tini git ca-certificates curl python3 build-essential \
    && rm -rf /var/lib/apt/lists/*

# Pre-install the canonical package managers so user projects don't have
# to download them on every cold-start.
RUN corepack enable \
 && corepack prepare yarn@1.22.22 --activate \
 && corepack prepare pnpm@9.12.0 --activate

WORKDIR /runner
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY index.js ./

# /project is where each preview's user files get synced. Empty in the
# image — populated by POST /sync at runtime.
RUN mkdir -p /project

# Image-level defaults. NODE_ENV is intentionally NOT set here — the
# runner itself doesn't care, and leaving it unset lets per-spawn
# overrides in runner code be authoritative. (Previously this was
# baked to "production", which silently broke user Next.js dev
# servers: NODE_ENV=production made next dev fall back to a
# production-mode CSS pipeline that skips PostCSS for App Router
# globals.css → "Unexpected character '@'" build failures.)
ENV RUNNER_PORT=8080 \
    USER_DEV_PORT=3000

EXPOSE 8080 3000

# tini ensures SIGTERM cascades to the user's dev server.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/runner/index.js"]
