/**
 * services/backend/src/routes/geojson.js
 *
 * GET /api/places/geojson?bbox=west,south,east,north&category=...&limit=500
 *
 * Returns a GeoJSON FeatureCollection of places in the viewport.
 * Used by Leaflet frontend to render polygon overlays.
 *
 * Performance:
 *  - Uses geom_3857_simple_mid for moderate zoom
 *  - GiST index on geom makes bbox query fast
 *  - Limit 500 per request (enough for any viewport)
 */

import { query } from "../db.js";

export default async function geojsonRoutes(fastify) {
  fastify.get("/api/places/geojson", async (request, reply) => {
    const { bbox, category, limit = 500 } = request.query;

    if (!bbox) return reply.code(400).send({ error: "bbox required" });

    const parts = bbox.split(",").map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      return reply.code(400).send({ error: "Invalid bbox format: west,south,east,north" });
    }

    const [west, south, east, north] = parts;
    const lim = Math.min(parseInt(limit, 10) || 500, 1000);

    // Build envelope for spatial filter
    const zoom = parseInt(request.query.zoom || "14", 10);
    // At low zoom serve fewer but larger objects; at high zoom serve more
    const zoomLim = zoom <= 12 ? 200 : zoom <= 14 ? 500 : lim;

    const sql = `
      SELECT
        p.wikimapia_id,
        p.name,
        COALESCE(p.category, 'wikimapia') AS category,
        LEFT(COALESCE(p.description, ''), 200) AS description,
        p.source_url,
        ROUND(ST_Area(p.geom::geography)::numeric, 0)::int AS area_m2,
        ST_AsGeoJSON(p.geom, 6) AS geom_json
      FROM places p
      WHERE p.geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
        AND ST_Intersects(p.geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
        ${category ? "AND p.category = $5" : ""}
      ORDER BY ST_Area(p.geom) DESC
      LIMIT ${zoomLim}
    `;

    const params = category
      ? [west, south, east, north, category]
      : [west, south, east, north];

    try {
      const result = await query(sql, params);

      const features = result.rows
        .filter(r => r.geom_json)
        .map(r => ({
          type: "Feature",
          id: r.wikimapia_id,
          geometry: JSON.parse(r.geom_json),
          properties: {
            wikimapia_id: r.wikimapia_id,
            name:         r.name,
            category:     r.category,
            description:  r.description,
            source_url:   r.source_url,
            area_m2:      r.area_m2 || 0,
          },
        }));

      return reply
        .header("Content-Type", "application/geo+json")
        .header("Cache-Control", "public, max-age=30")
        .header("Access-Control-Allow-Origin", "*")
        .send({
          type: "FeatureCollection",
          features,
        });

    } catch (err) {
      request.log.error({ err }, "GeoJSON query error");
      return reply.code(500).send({ error: "GeoJSON query failed" });
    }
  });
}
