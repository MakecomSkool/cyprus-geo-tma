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

  // Build the MVT query
  // ST_TileEnvelope returns 3857. ST_AsMVTGeom expects 3857.
  // We transform geom to 3857 and intersect in 3857 space
  // to leverage the functional index (idx_places_geom_3857).
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
          ST_Transform(p.geom, 3857),
          tile_bounds.geom,
          4096,   -- extent (standard MVT resolution)
          256,    -- buffer (pixels for label/line overflow)
          true    -- clip geometry to tile bounds
        ) AS mvt_geom
      FROM places p, tile_bounds
      WHERE ST_Intersects(
        ST_Transform(p.geom, 3857),
        tile_bounds.geom
      )
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
      .header("Cache-Control", "public, max-age=3600, s-maxage=86400")
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
