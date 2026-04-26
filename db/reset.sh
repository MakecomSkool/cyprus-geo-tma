#!/usr/bin/env bash
# db/reset.sh — Destroy and recreate the dev database from scratch.
#
# Usage:
#     bash db/reset.sh          # from project root
#     cd db && bash reset.sh    # from db/ directory
#
# Requires: docker compose, python3, psycopg2, python-dotenv

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "========================================"
echo "  Cyprus Geo DB — Full Reset"
echo "========================================"
echo ""

# ── Step 1: Stop and destroy containers + volumes ──
echo "[1/5] Stopping containers and removing volumes..."
docker compose down -v 2>/dev/null || true

# ── Step 2: Start fresh PostgreSQL ──
echo "[2/5] Starting PostgreSQL + PostGIS..."
docker compose up -d db
echo "  Waiting for database to be ready..."
until docker compose exec db pg_isready -U "${POSTGRES_USER:-cyprus}" -d "${POSTGRES_DB:-cyprus_geo}" > /dev/null 2>&1; do
    sleep 1
done
echo "  Database is ready."

# ── Step 3: Apply migrations ──
echo "[3/5] Applying migrations..."
python db/migrate.py

# ── Step 4: Seed places data ──
echo "[4/5] Seeding places from GeoJSON..."
python db/seeds/seed_places.py

# ── Step 5: Verify ──
echo "[5/5] Running smoke test..."
docker compose exec db psql -U "${POSTGRES_USER:-cyprus}" -d "${POSTGRES_DB:-cyprus_geo}" -c "
    SELECT 'tables' AS check, COUNT(*)::text AS result FROM information_schema.tables WHERE table_schema = 'public' AND table_name NOT LIKE '\_%'
    UNION ALL
    SELECT 'places', COUNT(*)::text FROM places
    UNION ALL
    SELECT 'nicosia_bbox', COUNT(*)::text FROM places WHERE ST_Intersects(geom, ST_MakeEnvelope(33.3, 35.1, 33.4, 35.2, 4326));
"

echo ""
echo "========================================"
echo "  Reset complete!"
echo "========================================"
