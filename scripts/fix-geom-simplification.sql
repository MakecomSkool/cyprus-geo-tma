-- Fix generated geometry columns with proper simplification tolerances
-- The old tolerances (100m, 30m) were destroying small building polygons into triangles
-- 
-- New tolerances:
--   geom_3857_simple_low (z<=11): 5m  -- city overview, buildings still visible as shapes
--   geom_3857_simple_mid (z<=14): 1m  -- street level, full accuracy effectively

BEGIN;

-- Drop old columns and indexes
DROP INDEX IF EXISTS idx_places_geom_3857_simple_low;
DROP INDEX IF EXISTS idx_places_geom_3857_simple_mid;

ALTER TABLE places
  DROP COLUMN IF EXISTS geom_3857_simple_low,
  DROP COLUMN IF EXISTS geom_3857_simple_mid;

-- Recreate with proper tolerances
ALTER TABLE places
  ADD COLUMN geom_3857_simple_low GEOMETRY(GEOMETRY, 3857)
    GENERATED ALWAYS AS (
      ST_SimplifyPreserveTopology(ST_Transform(geom, 3857), 5)
    ) STORED,
  ADD COLUMN geom_3857_simple_mid GEOMETRY(GEOMETRY, 3857)
    GENERATED ALWAYS AS (
      ST_SimplifyPreserveTopology(ST_Transform(geom, 3857), 1)
    ) STORED;

-- Rebuild indexes
CREATE INDEX idx_places_geom_3857_simple_low ON places USING GIST (geom_3857_simple_low);
CREATE INDEX idx_places_geom_3857_simple_mid ON places USING GIST (geom_3857_simple_mid);

COMMIT;

-- Verify: avg points should be close to original now
SELECT 
  ROUND(AVG(ST_NPoints(geom))::numeric, 1) as avg_orig,
  ROUND(AVG(ST_NPoints(geom_3857_simple_low))::numeric, 1) as avg_low_5m,
  ROUND(AVG(ST_NPoints(geom_3857_simple_mid))::numeric, 1) as avg_mid_1m,
  COUNT(*) as total
FROM places;

ANALYZE places;
