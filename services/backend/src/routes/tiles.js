/**
 * services/backend/src/routes/tiles.js
 *
 * Dynamic MVT (Mapbox Vector Tile) generation via PostGIS.
 *
 * GET /api/tiles/:z/:x/:y.mvt
 *
 * Uses ST_TileEnvelope + ST_AsMVTGeom + ST_AsMVT to generate
 * protobuf tiles on the fly. Layer name: "places".
 *
 * Fields included per feature: wikimapia_id, name, description, category.
 *
 * Performance notes:
 *  - GiST index on geom makes ST_Intersects fast
 *  - Geometry is simplified via ST_AsMVTGeom (auto-simplification)
 *  - Empty tiles return 204 No Content (saves bandwidth)
 *  - Cache-Control headers allow CDN/browser caching
 */

import { pool } from "../db.js";

/**
 * Pick the appropriate geometry column based on zoom level (LOD).
 * Lower zoom → more simplified geometry → smaller tiles, faster render.
 */
function pickGeomColumn(z) {
  if (z <= 11) return "geom_3857_simple_low";
  if (z <= 14) return "geom_3857_simple_mid";
  return "geom_3857";
}

async function getTile(request, reply) {
  const z = parseInt(request.params.z, 10);
  const x = parseInt(request.params.x, 10);
  const y = parseInt(request.params.y, 10);

  // Validate params
  if (
    isNaN(z) || isNaN(x) || isNaN(y) ||
    z < 0 || z > 22 ||
    x < 0 || x >= Math.pow(2, z) ||
    y < 0 || y >= Math.pow(2, z)
  ) {
    return reply.code(400).send({ error: "Invalid tile coordinates" });
  }

  // Pick geometry column based on zoom (LOD)
  const geomCol = pickGeomColumn(z);

  // Build the MVT query using stored 3857 column + && (fast bbox overlap)
  const sql = `
    WITH
    tile_bounds AS (
      SELECT ST_TileEnvelope($1, $2, $3) AS geom
    ),
    tile_data AS (
      SELECT
        p.wikimapia_id,
        p.name,
        COALESCE(p.category, '') AS category,
        LEFT(p.description, 200) AS description,
        ST_AsMVTGeom(
          p.${geomCol},
          tile_bounds.geom,
          4096,
          256,
          true
        ) AS mvt_geom
      FROM places p, tile_bounds
      WHERE p.${geomCol} && tile_bounds.geom
        AND ST_Intersects(p.${geomCol}, tile_bounds.geom)
    )
    SELECT ST_AsMVT(tile_data, 'places', 4096, 'mvt_geom') AS mvt
    FROM tile_data
    WHERE mvt_geom IS NOT NULL
  `;

  try {
    const result = await pool.query(sql, [z, x, y]);
    const mvt = result.rows[0]?.mvt;

    // Empty tile
    if (!mvt || mvt.length === 0) {
      reply.code(204);
      return;
    }

    return reply
      .header("Content-Type", "application/x-protobuf")
      .header("Content-Encoding", "identity")
      .header("Cache-Control", "public, max-age=3600, s-maxage=604800")
      .header("Access-Control-Allow-Origin", "*")
      .send(Buffer.from(mvt));
  } catch (err) {
    request.log.error({ err, z, x, y }, "Tile generation error");
    return reply.code(500).send({ error: "Tile generation failed" });
  }
}

/**
 * Register tile routes on Fastify instance.
 */
export default async function tilesRoutes(fastify) {
  fastify.get("/api/tiles/:z/:x/:y.mvt", getTile);
}
