-- 0003_places.sql
-- Places table: geographic objects from Wikimapia (and future sources).

CREATE TABLE IF NOT EXISTS places (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wikimapia_id  BIGINT UNIQUE,                          -- Wikimapia source ID (nullable for user-created places)
    name          VARCHAR(512) NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    photos        TEXT[] NOT NULL DEFAULT '{}',            -- array of photo URLs
    source_url    TEXT NOT NULL DEFAULT '',                -- e.g. http://wikimapia.org/12345/
    geom          GEOMETRY(GEOMETRY, 4326) NOT NULL,       -- Polygon or MultiPolygon, EPSG:4326
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Spatial index (GiST) ── critical for ST_Intersects / ST_DWithin queries
CREATE INDEX IF NOT EXISTS idx_places_geom
    ON places USING GIST (geom);

-- ── Fast lookup by Wikimapia source ID (for upsert / deduplication)
CREATE INDEX IF NOT EXISTS idx_places_wikimapia_id
    ON places (wikimapia_id)
    WHERE wikimapia_id IS NOT NULL;

-- ── Auto-update updated_at
CREATE TRIGGER trg_places_updated_at
    BEFORE UPDATE ON places
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
