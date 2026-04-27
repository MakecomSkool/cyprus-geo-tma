-- Fill pre-projected geometry columns for all Wikimapia places
-- This makes MVT tile generation instant (no on-the-fly ST_Transform)

UPDATE places SET
  geom_3857 = ST_Transform(geom, 3857),
  geom_3857_simple_low = ST_SimplifyPreserveTopology(ST_Transform(geom, 3857), 500),
  geom_3857_simple_mid = ST_SimplifyPreserveTopology(ST_Transform(geom, 3857), 100)
WHERE geom_3857 IS NULL
  AND geom IS NOT NULL;

-- Report
SELECT 
  COUNT(*) FILTER (WHERE geom_3857 IS NOT NULL) AS with_geom_3857,
  COUNT(*) FILTER (WHERE geom_3857 IS NULL) AS missing_geom_3857,
  COUNT(*) AS total
FROM places;
