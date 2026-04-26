"""
db/seeds/seed_places.py — Import places from data/cyprus_places.geojson into PostGIS.

Usage:
    python db/seeds/seed_places.py        # from project root or db/seeds/

Features:
    - Reads GeoJSON FeatureCollection from data/cyprus_places.geojson
    - Inserts/updates places via UPSERT on wikimapia_id (idempotent)
    - Uses ST_GeomFromGeoJSON for geometry import
    - Batch processing with progress reporting
    - Validates geometry with ST_IsValid + ST_MakeValid
"""

import json
import os
import sys
from pathlib import Path

# Force UTF-8 stdout on Windows (prevents cp1251 encoding errors)
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Ensure project root for .env loading
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass

import psycopg2
from psycopg2.extras import execute_values


GEOJSON_PATH = PROJECT_ROOT / "data" / "cyprus_places.geojson"

BATCH_SIZE = 500

UPSERT_SQL = """
INSERT INTO places (wikimapia_id, name, description, photos, source_url, geom)
VALUES %s
ON CONFLICT (wikimapia_id)
DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    photos      = EXCLUDED.photos,
    source_url  = EXCLUDED.source_url,
    geom        = EXCLUDED.geom,
    updated_at  = NOW()
"""

# Template for execute_values — ST_MakeValid ensures geometry validity in DB
VALUE_TEMPLATE = """(
    %(wikimapia_id)s,
    %(name)s,
    %(description)s,
    %(photos)s,
    %(source_url)s,
    ST_MakeValid(ST_GeomFromGeoJSON(%(geom_json)s))
)"""


def get_connection():
    """Create a PostgreSQL connection from DATABASE_URL or individual vars."""
    url = os.getenv("DATABASE_URL")
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        user=os.getenv("POSTGRES_USER", "cyprus"),
        password=os.getenv("POSTGRES_PASSWORD", "cyprus_dev_2026"),
        dbname=os.getenv("POSTGRES_DB", "cyprus_geo"),
    )


def load_geojson(path: Path) -> list[dict]:
    """Load and parse the GeoJSON FeatureCollection."""
    print(f"Loading GeoJSON from {path}...")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    print(f"  Found {len(features)} features.")
    return features


def feature_to_row(feature: dict) -> dict | None:
    """Convert a GeoJSON Feature to a database row dict."""
    props = feature.get("properties", {})
    geom = feature.get("geometry")

    if not geom:
        return None

    wikimapia_id = props.get("wikimapia_id")
    if wikimapia_id is None:
        return None

    return {
        "wikimapia_id": int(wikimapia_id),
        "name": (props.get("name") or "").strip()[:512],
        "description": (props.get("description") or "").strip(),
        "photos": props.get("photos") or [],
        "source_url": (props.get("url") or "").strip(),
        "geom_json": json.dumps(geom),
    }


def seed(conn, features: list[dict]):
    """Insert/update features into the places table in batches."""
    rows = []
    skipped = 0
    for f in features:
        row = feature_to_row(f)
        if row:
            rows.append(row)
        else:
            skipped += 1

    if skipped:
        print(f"  Skipped {skipped} features (missing geometry or wikimapia_id).")

    total = len(rows)
    print(f"  Upserting {total} rows in batches of {BATCH_SIZE}...")

    inserted = 0
    with conn.cursor() as cur:
        for i in range(0, total, BATCH_SIZE):
            batch = rows[i : i + BATCH_SIZE]
            execute_values(
                cur,
                UPSERT_SQL,
                batch,
                template=VALUE_TEMPLATE,
                page_size=BATCH_SIZE,
            )
            inserted += len(batch)
            pct = (inserted / total) * 100
            print(f"    [{inserted}/{total}] {pct:.0f}%")

    conn.commit()
    return inserted


def verify(conn):
    """Run basic checks after seeding."""
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM places;")
        count = cur.fetchone()[0]
        print(f"\n  Total places in DB: {count}")

        cur.execute("""
            SELECT COUNT(*) FROM places
            WHERE NOT ST_IsValid(geom);
        """)
        invalid = cur.fetchone()[0]
        print(f"  Invalid geometries: {invalid}")

        # Smoke test: bbox query over Nicosia (should return >= 1)
        cur.execute("""
            SELECT COUNT(*) FROM places
            WHERE ST_Intersects(
                geom,
                ST_MakeEnvelope(33.3, 35.1, 33.4, 35.2, 4326)
            );
        """)
        nicosia = cur.fetchone()[0]
        print(f"  Places in Nicosia bbox: {nicosia}")

        if nicosia > 0:
            print("\n  SMOKE TEST PASSED: ST_Intersects returns results.")
        else:
            print("\n  SMOKE TEST FAILED: ST_Intersects returned 0 results!")

        # Show a few sample names
        cur.execute("""
            SELECT name, wikimapia_id, ST_GeometryType(geom)
            FROM places
            WHERE name != ''
            LIMIT 10;
        """)
        print("\n  Sample places:")
        for row in cur.fetchall():
            print(f"    - {row[0]} (wm:{row[1]}, {row[2]})")


def main():
    if not GEOJSON_PATH.exists():
        print(f"ERROR: GeoJSON file not found: {GEOJSON_PATH}")
        print("  Run the scraper first (Agent 1).")
        sys.exit(1)

    features = load_geojson(GEOJSON_PATH)

    print("Connecting to database...")
    conn = get_connection()

    try:
        inserted = seed(conn, features)
        print(f"\n  Done! Upserted {inserted} places.")
        verify(conn)
    except Exception as e:
        conn.rollback()
        print(f"\nERROR: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
