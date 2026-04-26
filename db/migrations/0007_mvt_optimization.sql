-- 0007_mvt_optimization.sql
-- Add GiST index on geometry transformed to EPSG:3857 for fast MVT tile generation.
-- ST_TileEnvelope returns 3857, so this index avoids runtime transform.

-- ── Functional index: geom in Web Mercator ────────────────────
CREATE INDEX IF NOT EXISTS idx_places_geom_3857
  ON places USING GIST (ST_Transform(geom, 3857));

-- ── Analyze table to update planner statistics ────────────────
ANALYZE places;
