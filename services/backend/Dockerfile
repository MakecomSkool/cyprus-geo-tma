# ───────────────────────────────────────────────────────────────
# services/backend/Dockerfile — Fastify API + Socket.IO
# Multi-stage build, non-root user
# ───────────────────────────────────────────────────────────────

# ── Stage 1: install dependencies ────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Stage 2: production image ────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Security: non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy production deps and source
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/

# Runtime config
ENV NODE_ENV=production
ENV BACKEND_PORT=3000
EXPOSE 3000

USER appuser
CMD ["node", "src/index.js"]
