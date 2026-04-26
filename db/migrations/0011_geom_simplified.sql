-- 0011: Simplified geometries for low-zoom tiles (LOD).
--
-- At low zoom levels (z≤11), full polygon details are invisible.
-- Pre-computing simplified versions reduces MVT tile size by 3-5x and speeds up rendering.
--
-- Tolerances:
--   geom_3857_simple_low  (z≤11):  ~100m → suitable for island overview
--   geom_3857_simple_mid  (z≤14):  ~30m  → suitable for city-level view

ALTER TABLE places
  ADD COLUMN IF NOT EXISTS geom_3857_simple_low GEOMETRY(GEOMETRY, 3857)
  GENERATED ALWAYS AS (
    ST_SimplifyPreserveTopology(ST_Transform(geom, 3857), 100)
  ) STORED,
  ADD COLUMN IF NOT EXISTS geom_3857_simple_mid GEOMETRY(GEOMETRY, 3857)
  GENERATED ALWAYS AS (
    ST_SimplifyPreserveTopology(ST_Transform(geom, 3857), 30)
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_places_geom_3857_simple_low
  ON places USING GIST (geom_3857_simple_low);

CREATE INDEX IF NOT EXISTS idx_places_geom_3857_simple_mid
  ON places USING GIST (geom_3857_simple_mid);

ANALYZE places;
