# ───────────────────────────────────────────────────────────────
# services/frontend/Dockerfile — React (Vite) → Nginx static
# Multi-stage build, non-root Nginx
# ───────────────────────────────────────────────────────────────

# ── Stage 1: build React app ─────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Build-time env vars (Vite bakes VITE_* into the bundle)
ARG VITE_API_URL
ARG VITE_WS_URL
ARG VITE_MAPBOX_TOKEN
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_WS_URL=${VITE_WS_URL}
ENV VITE_MAPBOX_TOKEN=${VITE_MAPBOX_TOKEN}

RUN npm run build

# ── Stage 2: serve with Nginx ────────────────────────────────
FROM nginx:1.27-alpine AS runner

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom Nginx config for SPA
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Health check
    location /health {
        return 200 'ok';
        add_header Content-Type text/plain;
    }
}
EOF

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
