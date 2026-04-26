# Technical Decisions

## Phase 1 — Data Ingestion

### D1: Package manager — `uv` over `poetry`
**Date**: 2026-04-25
**Decision**: Use `uv` for the scraper project.
**Rationale**:
- Significantly faster dependency resolution and installation
- Simpler configuration (standard `pyproject.toml` without poetry-specific sections)
- Better suited for script-oriented projects (vs. library-oriented)
- Growing ecosystem adoption

### D2: Data source — Wikimapia KML endpoint over JSON API
**Date**: 2026-04-25
**Decision**: Use Wikimapia's internal KML endpoint (`/d?BBOX=`) instead of the official JSON API.
**Rationale**:
- The official JSON API (`api.wikimapia.org`) with the free `example` key returns empty arrays as of 2026
- A personal API key requires registration and is rate-limited to 100 req/5min
- The KML endpoint is used by the Wikimapia web map itself and returns rich polygon data
- KML endpoint requires cookie-based verification (status 218 challenge) but is otherwise reliable
- Rate limiting is more lenient (~1.5s between requests works reliably)

### D3: Grid tiling strategy — 0.1° tiles
**Date**: 2026-04-25
**Decision**: Use 0.1° × 0.1° grid tiles to partition the Cyprus bounding box.
**Rationale**:
- KML endpoint caps at ~800 places per response regardless of tile size
- 0.1° tiles provide good coverage with ~325 total tiles
- Many tiles fall over the Mediterranean and return empty (fast to process)
- Larger tiles (0.5°) miss places in dense urban areas due to the cap
- Smaller tiles (0.05°) would require ~1,300 requests, adding unnecessary time

### D4: Geometry handling — Polygon/MultiPolygon only
**Date**: 2026-04-25
**Decision**: Only accept Polygon and MultiPolygon geometries in the output GeoJSON.
**Rationale**:
- PostGIS import expects clean geometry types for spatial indexing
- `shapely.validation.make_valid()` sometimes produces GeometryCollections from self-intersecting polygons
- We extract the Polygon/MultiPolygon components from GeometryCollections
- Points and LineStrings are discarded (not useful for place boundaries)

### D5: Synchronous HTTP over async
**Date**: 2026-04-25
**Decision**: Use synchronous `httpx.Client` instead of async.
**Rationale**:
- Rate limiting (1.5s between requests) eliminates any benefit from async
- Synchronous code is simpler to understand and debug
- The scraper is a one-shot batch process, not a long-running server

### D6: Checkpoint/resume for idempotency
**Date**: 2026-04-25
**Decision**: Save progress to a JSON checkpoint file after each tile, enabling resume on interruption.
**Rationale**:
- Full Cyprus scrape takes ~8 minutes; interruption should not lose progress
- Checkpoint stores completed tile IDs and all collected places
- Re-running the scraper with an existing checkpoint continues from where it stopped
- For a clean re-scrape, delete `data/.scraper_checkpoint.json`

## Phase 2 — Database Setup

### D7 (ADR-0001): Migration tooling — Plain SQL + Python runner over Alembic / node-pg-migrate
**Date**: 2026-04-25
**Decision**: Use plain `.sql` migration files executed by a lightweight Python runner (`db/migrate.py`) with a `_migrations` tracking table.
**Alternatives considered**:
- **Alembic** (Python ORM-based): Overkill for this project; adds SQLAlchemy dependency; auto-generation requires model classes we don't have.
- **node-pg-migrate** (Node.js): Would add a Node.js dependency to a Python-centric DB layer; extra toolchain.
- **Flyway / Liquibase** (JVM): Java dependency; enterprise-oriented; too heavy.
**Rationale**:
- The schema is small (3 tables + 1 extension) and hand-crafted SQL is the clearest way to express PostGIS DDL
- A Python runner with `psycopg2` is trivial (~100 LOC) and has zero extra dependencies beyond what the seeder already needs
- Tracks applied migrations in a `_migrations` table for idempotency
- SQL files are version-controlled and human-readable

### D8: Geometry column type — `GEOMETRY(GEOMETRY, 4326)` over typed constraint
**Date**: 2026-04-25
**Decision**: Use the generic `GEOMETRY` type with SRID 4326 instead of `GEOMETRY(POLYGON, 4326)`.
**Rationale**:
- Source data contains both Polygon and MultiPolygon geometries (12,799 Polygon + 16 MultiPolygon)
- A typed constraint (`POLYGON`) would reject MultiPolygon inserts
- PostGIS GiST index works identically on generic GEOMETRY
- Allows future flexibility for Point or LineString data from other sources

### D9: PostGIS image — `postgis/postgis:15-3.4`
**Date**: 2026-04-25
**Decision**: Use the official `postgis/postgis:15-3.4` Docker image.
**Rationale**:
- Pre-built with PostGIS extension; no manual compilation needed
- PostgreSQL 15 provides latest query planner improvements
- PostGIS 3.4 is the current stable release with full GeoJSON support
- Image is maintained by the PostGIS project itself

### D10: GeoJSON property `url` → DB column `source_url`
**Date**: 2026-04-25
**Decision**: Rename the GeoJSON `url` property to `source_url` in the database schema.
**Rationale**:
- `url` is a very generic column name that could conflict with future columns
- `source_url` is self-documenting: it indicates the Wikimapia source page
- Agent 1's GeoJSON property name is preserved as-is; mapping is done in the seeder

## Phase 3 — Backend API

### D11 (ADR-0002): Backend framework — Fastify 5 over NestJS / FastAPI
**Date**: 2026-04-25
**Decision**: Use Fastify 5 (Node.js) as the backend framework.
**Alternatives considered**:
- **NestJS**: Full-featured but heavy; decorator-based DI is overkill for 3 routes; large boilerplate.
- **FastAPI** (Python): Natural fit for Python-centric project, but WebSocket support via `python-socketio` is less mature than Socket.IO on Node.js; Telegram Mini Apps ecosystem is JS-first.
- **Express**: Legacy, no native async/await, slower than Fastify.
**Rationale**:
- Fastify 5 is the fastest Node.js framework with built-in Pino logging and schema validation
- Socket.IO has first-class Node.js support (same runtime for HTTP + WS)
- The Telegram TMA frontend will be JS — same language on both ends reduces context switching
- `pg` driver works well with PostGIS (ST_AsGeoJSON returns JSON directly)
- Lightweight: ~100 LOC for the entire server, zero boilerplate

### D12 (ADR-0003): WebSocket library — Socket.IO 4 over ws / Fastify-websocket
**Date**: 2026-04-25
**Decision**: Use Socket.IO 4.x for real-time messaging.
**Alternatives considered**:
- **ws** (raw WebSocket): No rooms, no reconnection, no acknowledgements — would need manual implementation.
- **@fastify/websocket**: Thin wrapper over ws; no rooms or broadcast built-in.
**Rationale**:
- Socket.IO provides rooms (per-place messaging), auto-reconnection, and binary transport out of the box
- Well-documented handshake auth via `io.use()` middleware
- Compatible with all TMA platforms (browser, iOS, Android WebView)
- Backward-compatible fallback to HTTP long-polling if WebSocket fails

### D13: Telegram initData dev bypass
**Date**: 2026-04-25
**Decision**: When `TELEGRAM_BOT_TOKEN` is not set or is `YOUR_BOT_TOKEN_HERE`, skip HMAC validation and use a dev user.
**Rationale**:
- Enables local development without a Telegram bot
- initData is only available from the Telegram WebApp JS SDK
- Production deployments must set a real bot token

## Phase 4 — Frontend TMA

### D14 (ADR-0004): State management — Zustand over Redux / Jotai / MobX
**Date**: 2026-04-25
**Decision**: Use Zustand for client-side state management.
**Alternatives considered**:
- **Redux Toolkit (RTK)**: Mature but heavyweight for 2 stores; boilerplate for actions/reducers/slices.
- **Jotai**: Atomic model is good for forms, but not ideal for the "fetch on moveend" pattern.
- **MobX**: Observable model adds complexity; requires decorators or `observer()` wrappers.
**Rationale**:
- Only 2 stores needed (map + chat) — Zustand's simplicity is a perfect fit
- Zero boilerplate: `create((set, get) => ({...}))` with plain functions
- Works with React 19 StrictMode without issues
- 1.2 KB gzipped — critical for TMA performance on mobile

### D15: Map library — Mapbox GL JS over Leaflet / MapLibre
**Date**: 2026-04-25
**Decision**: Use Mapbox GL JS v3 for the interactive map.
**Rationale**:
- WebGL rendering handles 12,815 polygon features without DOM bottleneck
- Feature state API (`setFeatureState`) enables hover/active styles without re-rendering
- GeoJSON source accepts the API response directly
- Premium base map styles (satellite, terrain) for Cyprus geography

### D16: Bottom sheet — Custom Framer Motion over react-spring / @gorhom/bottom-sheet
**Date**: 2026-04-25
**Decision**: Build a custom bottom sheet using Framer Motion's `drag` and `AnimatePresence`.
**Rationale**:
- No RN dependency (`@gorhom/bottom-sheet` is React Native only)
- Framer Motion provides spring physics, drag constraints, and velocity-based dismiss
- Full control over Telegram theme integration and mobile safe areas
- 10 KB addition vs. a full sheet library

### D17: CSS strategy — Tailwind v4 + Telegram CSS variables
**Date**: 2026-04-25
**Decision**: Use Tailwind CSS v4 (Vite plugin) combined with Telegram theme CSS variables.
**Rationale**:
- Telegram injects `--tg-theme-*` CSS variables; mapping them to component styles gives automatic light/dark support
- Tailwind v4 requires zero config files (`@import "tailwindcss"` in CSS)
- Utility classes reduce CSS file size while custom CSS handles Telegram-specific patterns

## Phase 5 — Deployment (DevOps)

### D18 (ADR-0005): Reverse proxy — Nginx over Traefik / Caddy
**Date**: 2026-04-25
**Decision**: Use Nginx 1.27-alpine as the single entry-point reverse proxy.
**Alternatives considered**:
- **Traefik**: Auto-discovery via Docker labels; great for Kubernetes but overkill for a single-host Compose stack.
- **Caddy**: Automatic HTTPS via ACME; simpler config, but WebSocket proxy requires explicit config similar to Nginx.
**Rationale**:
- Nginx is the most widely deployed reverse proxy — deep community support and documentation
- Explicit `proxy_set_header Upgrade` / `Connection` headers give full control over WebSocket handshake
- 6 MB alpine image; zero runtime dependencies
- When TLS is needed, a `certbot` sidecar or Cloudflare proxy can be added without changing the Nginx core config

### D19: Container strategy — Multi-stage builds, non-root users
**Date**: 2026-04-25
**Decision**: All custom Dockerfiles use multi-stage builds with non-root `appuser`.
**Rationale**:
- Build dependencies (npm, dev packages) are excluded from the final image — smaller attack surface
- Non-root user prevents container escape privilege escalation
- Node 22-alpine base keeps backend image < 100 MB
- Frontend uses Nginx alpine for static serving (no Node runtime in production)

### D20: Orchestration — Docker Compose v2 over Kubernetes / Nomad
**Date**: 2026-04-25
**Decision**: Use Docker Compose v2 for local and single-host deployment.
**Rationale**:
- 5 services fit comfortably on a single host
- `depends_on` with `condition: service_healthy` ensures correct startup order
- One-shot `migrate` service with `restart: "no"` handles DB initialization
- Migration to Kubernetes is straightforward when horizontal scaling is needed

### D21: Migrate container — One-shot over init-container / entrypoint script
**Date**: 2026-04-25
**Decision**: Run migrations and seeding as a separate one-shot Docker service (`restart: "no"`) rather than embedding in the backend entrypoint.
**Rationale**:
- Clear separation of concerns: the backend service only serves HTTP/WS
- `condition: service_completed_successfully` ensures backend starts only after migrations succeed
- Idempotent scripts (UPSERT, IF NOT EXISTS) make re-runs safe
- Can be triggered independently: `docker compose run --rm migrate`
