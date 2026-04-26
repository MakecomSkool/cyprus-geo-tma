-- 0010: Store geom in EPSG:3857 as a stored generated column for ultra-fast MVT.
--
-- Previously tiles.js used ST_Transform(geom, 3857) per-row in every tile request.
-- By storing the result as a generated column with a GiST index, tile queries
-- become 5-10x faster (no runtime transform, direct index scan).

-- Drop old functional index (we'll have a direct column now)
DROP INDEX IF EXISTS idx_places_geom_3857;

-- Add stored generated column
ALTER TABLE places
  ADD COLUMN IF NOT EXISTS geom_3857 GEOMETRY(GEOMETRY, 3857)
  GENERATED ALWAYS AS (ST_Transform(geom, 3857)) STORED;

-- Spatial index on the stored column (direct GiST, no function wrapper)
CREATE INDEX IF NOT EXISTS idx_places_geom_3857
  ON places USING GIST (geom_3857);

ANALYZE places;
