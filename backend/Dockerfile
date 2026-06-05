# Build context is the repo ROOT (see compose.yaml), so paths are repo-relative.
FROM node:20

WORKDIR /app

# Install backend deps first (better layer caching). better-sqlite3 is native;
# the full node:20 image ships the toolchain, and prebuilt binaries are used when
# available, so no extra build deps are needed.
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# App code + the static frontend (served by Fastify).
COPY backend ./backend
COPY frontend ./frontend

WORKDIR /app/backend
EXPOSE 3000
CMD ["node", "src/server.js"]
