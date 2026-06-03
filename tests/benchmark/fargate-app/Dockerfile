# Build context: repo root (docker build -f tests/benchmark/fargate-app/Dockerfile .)
# This allows the builder to access both fargate-app/ and backend/ source trees.

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /build

# Copy fargate-app manifest and install deps (includes all backend SDK deps)
COPY tests/benchmark/fargate-app/package*.json ./
RUN npm ci

# Copy source: fargate-app entrypoints + full backend (handlers + shared)
COPY tests/benchmark/fargate-app/tsconfig.json ./
COPY tests/benchmark/fargate-app/adapter.ts   ./
COPY tests/benchmark/fargate-app/server.ts    ./
COPY backend/handlers/                          ./backend/handlers/
COPY backend/shared/                            ./backend/shared/

# Compile TypeScript → dist/
RUN npm run build

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /build/package*.json ./
RUN npm ci --production --ignore-scripts

COPY --from=builder /build/dist ./dist

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
