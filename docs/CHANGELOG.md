# Changelog

## Phase 5 — Deployment (2026-04-25)

**Agent 5 (DevOps)** containerized all services and set up Nginx reverse proxy.

### Added
- `services/backend/Dockerfile` — Multi-stage Node 22-alpine (non-root user)
- `services/frontend/Dockerfile` — Multi-stage Vite build → Nginx static (SPA fallback)
- `db/Dockerfile` — Python 3.12-slim one-shot migration + seed runner
- `docker-compose.yml` — Full stack: db, migrate, backend, frontend, nginx
- `infra/nginx/nginx.conf` — Reverse proxy with WebSocket upgrade for Socket.IO
- `README.md` — Architecture diagram (Mermaid), Quickstart, Troubleshooting
- `.env` → added `VITE_MAPBOX_TOKEN`, `APP_PORT`

### Infrastructure
- Nginx routes: `/` → frontend, `/api/` → backend, `/ws/` → backend (WS upgrade)
- Healthchecks on all services (pg_isready, wget /healthz, wget /health)
- One-shot `migrate` service with `service_completed_successfully` dependency
- Persistent `pgdata` volume for database

### Documentation
- `docs/ARCHITECTURE.md` → section "5. Infrastructure Topology" (service diagram, ports, env vars)
- `docs/DECISIONS.md` → D18-D21 (ADR-0005: Nginx, multi-stage, Compose, one-shot migrate)
- `docs/CHANGELOG.md` → This entry

### 🎉 Project Complete
All 5 phases finished. The full stack is ready for `docker compose up -d --build`.

## Phase 4 — Frontend TMA (2026-04-25)

**Agent 4 (Frontend Developer)** built the Telegram Mini App with interactive map and chat.

### Added
- `services/frontend/` — React 19 + Vite 8 application
  - Mapbox GL JS map centered on Cyprus with polygon layer (fill + outline)
  - Hover/active feature states for polygon interaction
  - Auto-reload places on map `moveend` via `/api/places?bbox=`
  - Bottom sheet (Framer Motion) with drag-to-dismiss
  - Chat UI: message bubbles (mine/other), keyset pagination, real-time via Socket.IO
  - Telegram WebApp SDK: `ready()`, `expand()`, theme integration (light/dark)
  - Zustand stores: `useMapStore` (places, selection) + `useChatStore` (messages, rooms)
  - API client auto-attaches `initData` to all requests
  - Socket.IO client with `initData` auth handshake
  - Tailwind CSS v4 + Telegram `--tg-theme-*` CSS variables

### Configuration
- `services/frontend/.env` → `VITE_MAPBOX_TOKEN`, `VITE_API_URL`, `VITE_WS_URL`
- Vite dev proxy: `/api` → backend:3000, `/ws` → backend:3000 (WS)

### Documentation
- `docs/ARCHITECTURE.md` → section "4. Frontend State & Routes" (stores, data flow diagram)
- `docs/DECISIONS.md` → D14-D17 (ADR-0004: Zustand, Mapbox, Framer Motion, Tailwind+TG vars)

### Verification
- `npm run build` succeeds (458 modules, 0 errors)
- Dev server starts on port 5173 with hot-reload
- Vite proxy correctly forwards `/api` and `/ws` to backend

## Phase 3 — Backend API (2026-04-25)

**Agent 3 (Backend Developer)** built the REST API, Telegram auth, and WebSocket server.

### Added
- `services/backend/` — Fastify 5 + Socket.IO 4 backend (Node.js, ESM)
  - `GET /healthz` — healthcheck with DB connectivity probe
  - `GET /api/places?bbox=` — spatial query via PostGIS ST_Intersects, returns GeoJSON FeatureCollection
  - `GET /api/places/:id/messages?cursor=&limit=` — keyset-paginated messages
  - Telegram `initData` HMAC-SHA256 validation middleware (with dev bypass)
  - User upsert on auth (by `telegram_id`)
  - Socket.IO rooms: `join_room`, `leave_room`, `send_message` → broadcast `new_message`
  - Pino structured logging, CORS, graceful shutdown
- `.env` → added `BACKEND_PORT`, `TELEGRAM_BOT_TOKEN`, `CORS_ORIGIN`

### Documentation
- `docs/ARCHITECTURE.md` → sections "2. REST API Contracts" and "3. WebSocket Events" filled
- `docs/DECISIONS.md` → D11 (ADR-0002: Fastify), D12 (ADR-0003: Socket.IO), D13 (dev bypass)

### Verification
- Healthcheck returns `{"status":"ok","db":"connected"}`
- Places bbox query (Nicosia) returns 500 features as GeoJSON FeatureCollection
- Messages endpoint returns correct keyset pagination structure
- All 4 requests logged with pino (method, URL, status, response time)

## Phase 2 — Database Setup (2026-04-25)

**Agent 2 (Database Architect)** set up PostgreSQL 15 + PostGIS 3.6.2 with schema, migrations, and seeder.

### Added
- `docker-compose.yml` — PostGIS container definition (for future containerized deploys)
- `.env` — Database connection variables
- `db/migrations/0001_init_extensions.sql` — PostGIS + uuid-ossp extensions
- `db/migrations/0002_users.sql` — Users table (Telegram users)
- `db/migrations/0003_places.sql` — Places table with PostGIS geometry column
- `db/migrations/0004_messages.sql` — Messages table (geo-social messages)
- `db/migrate.py` — Python migration runner with `_migrations` tracking table
- `db/seeds/seed_places.py` — GeoJSON → PostGIS importer (idempotent UPSERT)
- `db/reset.sh` / `db/reset.bat` — One-command dev database reset
- `db/requirements.txt` — Python DB dependencies (psycopg2-binary, python-dotenv)

### Infrastructure
- Installed PostgreSQL 15.17 locally via `winget`
- Installed PostGIS 3.6.2 bundle (GEOS, PROJ, GDAL)
- Created `cyprus` role (superuser for extension creation)
- Created `cyprus_geo` database

### Verification
- All 4 migrations applied successfully on clean database
- 12,815 places seeded from GeoJSON (0 skipped, 0 invalid geometries)
- Smoke test: 607 places found in Nicosia bbox via ST_Intersects
- Idempotent re-run: migrations skip, seeder UPSERT produces same count

### Documentation
- `docs/ARCHITECTURE.md` → Section "1. Database Schema" filled (DDL, indexes, ER diagram, spatial query examples)
- `docs/DECISIONS.md` → D7-D10 (migration tooling, geometry type, PostGIS image, field rename)
- `docs/CHANGELOG.md` → This entry

## Phase 1 — Data Ingestion (2026-04-25)

**Agent 1 (Data Engineer)** completed geodata collection from Wikimapia for Cyprus.

### Added
- `services/scraper/` — Python 3.11+ scraper project (managed by uv)
  - Wikimapia KML endpoint client with cookie verification and rate limiting
  - Grid-based bbox tiling (0.1° tiles, 325 total)
  - GeoJSON converter with shapely geometry validation
  - Checkpoint/resume support for interrupted runs
  - Deduplication by `wikimapia_id`
- `data/cyprus_places.geojson` — 12,815 places with polygon geometries (EPSG:4326)
- `services/scraper/README.md` — Setup and usage instructions
- `docs/ARCHITECTURE.md` — Section "6. Data Sources" with schema and example
- `docs/DECISIONS.md` — Technical decisions log
- `docs/CONTEXT.md` — Project context overview
- `docs/OPEN_QUESTIONS.md` — Known issues and blockers

### Technical Notes
- Official Wikimapia JSON API (`api.wikimapia.org`) with `example` key is non-functional (returns empty arrays). Switched to internal KML endpoint (`/d?BBOX=`).
- Total scrape time: ~8 minutes for full Cyprus coverage.
- All 12,815 geometries validated: 0 invalid, 0 empty, 0 out-of-bounds, 0 duplicates.
