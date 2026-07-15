# tdx D1 server image. Build context is the repo ROOT (see compose.yaml / CI), so
# it can COPY both server/ and the static frontend/. Multi-stage: compile TS in a
# full image, ship a slim runtime with prod deps + dist + migrations + frontend.

FROM node:22 AS build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
COPY server/scripts ./scripts
COPY server/migrations ./migrations
# tsc -> dist/ (compiles src/ + scripts/), then drop dev deps (native better-sqlite3
# / @node-rs/argon2 prebuilt binaries stay) so they can be copied to the runtime.
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app/server
# git: the notes vault backup shells out to it (server/src/vault-git.ts)
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    FRONTEND_DIR=/app/frontend \
    MIGRATIONS_DIR=/app/server/migrations
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/migrations ./migrations
COPY server/package.json ./
COPY frontend /app/frontend
EXPOSE 3000
# one-off admin tooling (compiled to dist/scripts):
#   docker compose run --rm tdx node dist/scripts/add-user.js <user> <email> <pw> --admin
#   docker compose run --rm tdx node dist/scripts/migrate-from-legacy.js <legacy.db> <target.db>
CMD ["node", "dist/src/app.js"]
