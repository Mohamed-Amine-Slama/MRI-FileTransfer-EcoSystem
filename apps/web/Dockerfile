# Container image for the MIR web frontend (Next.js).
#
# Build from the REPOSITORY ROOT, never from this directory:
#
#   docker build -f apps/web/Dockerfile -t mir-web .
#
# The pnpm workspace lockfile and packages/* live above this file; a context
# rooted at apps/web cannot see them.
#
# P8.2 / scripts/check-bundle-secrets.mjs: no server secret may reach the
# client bundle. The app defines no NEXT_PUBLIC_* variables, and this image
# takes no secret build arguments — the only build-time input is API_ORIGIN,
# which is a service address, not a credential.

# ---------------------------------------------------------------------------
# base — toolchain shared by every stage
# ---------------------------------------------------------------------------
# PINNED TO NODE 22, AND NOT BUMPABLE BY A ROBOT.
#
# Two independent reasons, either of which is sufficient:
#
#   1. COREPACK IS GONE FROM NODE 25 AND LATER. It was unbundled from the
#      Node.js distribution, so `corepack enable` below exits 127 — command not
#      found — and the build dies at the first RUN. That is exactly what
#      `bump node from 22-alpine to 26-alpine` produced.
#
#   2. The root package.json declares `engines: { node: ">=20.0.0 <25" }`. Node
#      26 is outside the range this project says it supports, so the image was
#      building the application on a runtime the repository does not claim to
#      work on.
#
# Node 22 is Active LTS and ships corepack 0.34.x. Moving off it means deciding
# how pnpm gets installed without corepack (a `npm i -g pnpm@9.15.4` layer, or
# a base image that bundles it) AND widening `engines` deliberately — not
# merging a one-line version bump.
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# ---------------------------------------------------------------------------
# manifests — see apps/api/Dockerfile: all four workspace manifests are
# required for --frozen-lockfile to validate, not just the ones web imports.
# ---------------------------------------------------------------------------
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/dicom-utils/package.json packages/dicom-utils/

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter "@mir/web..."

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/web apps/web

# Where this image should send /api/* — see the rewrites() block in
# next.config.mjs. Empty by default, which emits NO rewrite and leaves the
# deployed model intact (Cloudflare routes /api at the edge, P8.2/P14.3).
# docker-compose.yml passes http://api:3000 so the local stack is single-origin.
#
# This is a build argument and not a runtime variable because `next build`
# serialises the resolved config into the standalone output: the server reads
# .next/required-server-files.json and never re-evaluates next.config.mjs.
# Changing where /api goes therefore means rebuilding this image, not
# restarting the container.
ARG API_ORIGIN=""
ENV API_ORIGIN=$API_ORIGIN

# `...` builds @mir/contracts first — it publishes main: dist/index.js, and
# transpilePackages does not remove the need for it to resolve.
RUN pnpm --filter "@mir/web..." build

# ---------------------------------------------------------------------------
# runtime
#
# Nothing is installed here. `output: 'standalone'` already emitted a
# self-contained server with only the traced production dependencies, which is
# why this stage needs no pnpm install and no node_modules copy.
# ---------------------------------------------------------------------------
FROM base AS runtime
WORKDIR /app

ENV NODE_ENV=production
# The standalone server reads both. 0.0.0.0 rather than the Next default of
# localhost, which would accept only connections from inside the container and
# make the published port look dead.
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# The standalone tree is laid out relative to outputFileTracingRoot (pinned to
# the monorepo root in next.config.mjs), so it unpacks as ./apps/web/server.js
# with ./node_modules and ./packages beside it. Copying it to /app preserves
# those relative positions.
COPY --from=build /app/apps/web/.next/standalone ./
# Static assets are deliberately excluded from the standalone bundle and must
# be placed by hand, at the path the server expects.
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

# Static files served from the root path. `output: 'standalone'` does NOT
# include public/, exactly as it does not include .next/static, so it has to be
# placed by hand at the path the server expects.
#
# This line was missing, and its absence was invisible in development because
# `next dev` serves public/ from the source tree. Two things were 404ing in the
# container and nowhere else:
#
#   /theme-init.js   the pre-paint theme script (app/layout.tsx loads it
#                    `beforeInteractive`). Without it `data-theme` is only
#                    applied after hydration, so every container-served page
#                    load flashed white at a user who had chosen dark — the
#                    one failure that script exists to prevent.
#   /seq /map /helix the landing page's consent thumbnails and viewer poster,
#                    corridor map, and helix posters. The hero would have
#                    rendered with no helix.
#
# The Dockerfile previously carried a comment saying apps/web had no public/
# directory. That was true when it was written and stopped being true when the
# theme script landed.
COPY --from=build /app/apps/web/public ./apps/web/public

USER node

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD wget --quiet --spider --tries=1 http://127.0.0.1:3001/ || exit 1

CMD ["node", "apps/web/server.js"]
