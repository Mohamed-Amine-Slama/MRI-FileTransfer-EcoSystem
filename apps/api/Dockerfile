# Container image for the MIR API (NestJS).
#
# Build from the REPOSITORY ROOT, never from this directory:
#
#   docker build -f apps/api/Dockerfile -t mir-api .
#
# The pnpm workspace lockfile and packages/* live above this file; a context
# rooted at apps/api cannot see them. docker-compose.yml sets `context: .`
# for exactly this reason.
#
# ADR-7: this image is run locally against synthetic DICOM only. It carries no
# configuration and no secrets — every value arrives as a runtime env var, and
# the API refuses to boot if any required one is missing (P1.6).

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

# `sharp` is a production dependency, and its musl build links against libvips
# through the glibc compatibility shim. Installed in the base stage so the
# build and runtime stages agree; a runtime-only install would let the image
# build cleanly and then fail on first image derivation.
# apk upgrade: the node image lags Alpine security fixes (CVE-2026-14456 in
# libssl3/libcrypto3 shipped in it); the CI image scan fails on HIGH+ fixed CVEs.
RUN apk upgrade --no-cache && apk add --no-cache libc6-compat

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# Pinned to `packageManager` in the root package.json. Corepack refuses a
# mismatch, which is the point: pnpm-lock.yaml is only reproducible under the
# pnpm major that wrote it.
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# ---------------------------------------------------------------------------
# manifests — package.json files only, so a source edit does not bust the
# dependency cache
#
# ALL FOUR workspace manifests are copied, not just the three the API needs.
# `--frozen-lockfile` validates the lockfile against every importer it names,
# and a missing manifest is indistinguishable from an out-of-date lockfile.
# ---------------------------------------------------------------------------
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/dicom-utils/package.json packages/dicom-utils/

# ---------------------------------------------------------------------------
# build — compile the API and the workspace packages it imports
# ---------------------------------------------------------------------------
FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter "@mir/api..."

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/dicom-utils packages/dicom-utils
COPY apps/api apps/api

# The trailing `...` selects @mir/api AND its workspace dependencies, in
# dependency order. Both packages publish `main: dist/index.js`, so the API
# cannot typecheck against them until they are built.
RUN pnpm --filter "@mir/api..." build

# ---------------------------------------------------------------------------
# prod-deps — the same install, minus devDependencies
#
# A second resolved install rather than a prune of the build stage: it keeps
# the compiler, vitest and playwright toolchains out of the final image
# entirely instead of relying on a prune to remove them afterwards.
# ---------------------------------------------------------------------------
FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@mir/api..."

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM base AS runtime
WORKDIR /app

# The runtime runs `node` and nothing else. npm, corepack and the pnpm it
# prepared are build tools, and they carried most of the image's HIGH CVEs
# (tar, minimatch, brace-expansion, pnpm itself) into production for nothing.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/pnpm /usr/local/bin/pnpx /pnpm /root/.cache

# THE DIRECTORY LAYOUT IS LOAD-BEARING.
#
# defaultMigrationsDir() in apps/api/src/shared/db/migrator.ts resolves
# `__dirname/../../../migrations`. From dist/shared/db that is apps/api/
# migrations, so dist/ and migrations/ must remain siblings under apps/api.
# Flattening this tree to /app produces an image that builds fine and fails
# the moment a migration runs.
#
# Keeping the paths identical to the build stage also keeps pnpm's symlinked
# node_modules valid: the links into node_modules/.pnpm are relative, and
# resolve only if every directory sits where it sat at install time.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /app/apps/api/package.json ./apps/api/package.json
COPY --from=prod-deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=prod-deps /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=prod-deps /app/packages/dicom-utils/node_modules ./packages/dicom-utils/node_modules
COPY --from=prod-deps /app/packages/dicom-utils/package.json ./packages/dicom-utils/package.json

COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/dicom-utils/dist ./packages/dicom-utils/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/migrations ./apps/api/migrations

# Root for the development filesystem BlobStore. Created here, owned by the
# unprivileged user, so that a named volume mounted at this path inherits that
# ownership on first use — Docker seeds an empty volume from the image, and a
# volume created against a root-owned directory is unwritable by `node`.
#
# ADR-4 / P2.4: this store is development-only. StorageModule refuses to start
# in staging or production without a real S3-backed store, because originals on
# a container filesystem are one restart from being gone.
RUN mkdir -p /var/lib/mir/storage && chown -R node:node /var/lib/mir

# Unprivileged from here on. The `node` user ships with the base image.
USER node

# Every relative path the process resolves — including the migrations lookup
# above — is anchored here.
WORKDIR /app/apps/api

EXPOSE 3000

# busybox wget, present in Alpine, so the image needs no extra package for a
# probe. GET /health is the unauthenticated liveness route
# (apps/api/src/health/health.controller.ts).
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD wget --quiet --spider --tries=1 http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/main.js"]
