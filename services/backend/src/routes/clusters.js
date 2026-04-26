/**
 * services/backend/src/routes/clusters.js
 *
 * GET /api/places/clusters?bbox=...&zoom=Z&category=...&q=...
 *
 * Returns GeoJSON FeatureCollection with LOD strategy:
 *   zoom < 14  → supercluster aggregated points
 *   zoom 14-15 → centroids (point per place)
 *   zoom >= 16 → full polygons
 */

import { query } from "../db.js";
import Supercluster from "supercluster";

// In-memory cache for supercluster index (rebuilt on data change)
let clusterIndex = null;
let clusterBuiltAt = 0;
const CLUSTER_TTL_MS = 60_000; // rebuild every 60s max

/**
 * Build or return cached Supercluster index from all place centroids.
 */
async function getClusterIndex() {
  const now = Date.now();
  if (clusterIndex && now - clusterBuiltAt < CLUSTER_TTL_MS) {
    return clusterIndex;
  }

  const result = await query(`
    SELECT p.id, p.name, p.category,
           ST_Y(p.centroid) AS lat, ST_X(p.centroid) AS lon,
           COALESCE(ps.rating_avg, 0) AS rating,
           COALESCE(ps.messages_count, 0) AS messages_count
    FROM places p
    LEFT JOIN place_stats ps ON ps.place_id = p.id
    WHERE p.centroid IS NOT NULL
  `);

  const points = result.rows.map((r) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [parseFloat(r.lon), parseFloat(r.lat)] },
    properties: {
      id: r.id,
      name: r.name,
      category: r.category || null,
      rating: r.rating ? parseFloat(r.rating) : null,
      messagesCount: parseInt(r.messages_count, 10),
    },
  }));

  clusterIndex = new Supercluster({
    radius: 60,
    maxZoom: 15,
    minZoom: 0,
    minPoints: 3,
  });
  clusterIndex.load(points);
  clusterBuiltAt = now;
  return clusterIndex;
}

/**
 * Parse and validate bbox query parameter.
 * @returns {[number,number,number,number] | null}
 */
function parseBbox(raw) {
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return null;
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (minLon >= maxLon || minLat >= maxLat) return null;
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) return null;
  return [minLon, minLat, maxLon, maxLat];
}

async function getClusters(request, reply) {
  const bbox = parseBbox(request.query.bbox);
  if (!bbox) {
    return reply.code(400).send({
      error: "Missing or invalid bbox. Expected: minLon,minLat,maxLon,maxLat",
    });
  }

  const zoom = parseInt(request.query.zoom, 10);
  if (isNaN(zoom) || zoom < 0 || zoom > 22) {
    return reply.code(400).send({ error: "Missing or invalid zoom (0-22)" });
  }

  const category = request.query.category || null;
  const searchQuery = request.query.q || null;
  const [minLon, minLat, maxLon, maxLat] = bbox;

  // ── zoom < 14: supercluster ──────────────────────────────
  if (zoom < 14) {
    const index = await getClusterIndex();
    let features = index.getClusters([minLon, minLat, maxLon, maxLat], zoom);

    // Client-side filtering (supercluster doesn't support per-property filter)
    if (category) {
      features = features.filter(
        (f) => f.properties.cluster || f.properties.category === category
      );
    }

    // Map supercluster output to our response shape
    const mapped = features.map((f) => {
      if (f.properties.cluster) {
        return {
          type: "Feature",
          geometry: f.geometry,
          properties: {
            cluster: true,
            pointCount: f.properties.point_count,
            clusterId: f.id,
          },
        };
      }
      return {
        type: "Feature",
        geometry: f.geometry,
        properties: {
          id: f.properties.id,
          name: f.properties.name,
          category: f.properties.category,
          rating: f.properties.rating,
          messagesCount: f.properties.messagesCount,
        },
      };
    });

    return { type: "FeatureCollection", mode: "cluster", features: mapped };
  }

  // ── zoom 14-15: centroids ────────────────────────────────
  if (zoom < 16) {
    const params = [minLon, minLat, maxLon, maxLat];
    const conditions = [
      "p.centroid IS NOT NULL",
      "p.centroid && ST_MakeEnvelope($1, $2, $3, $4, 4326)",
    ];

    if (category) {
      params.push(category);
      conditions.push(`p.category = $${params.length}`);
    }
    if (searchQuery) {
      params.push(searchQuery);
      conditions.push(`p.search_tsv @@ plainto_tsquery('simple', $${params.length})`);
    }

    const sql = `
      SELECT p.id, p.name, p.category,
             ST_Y(p.centroid) AS lat, ST_X(p.centroid) AS lon,
             COALESCE(ps.rating_avg, 0) AS rating,
             COALESCE(ps.messages_count, 0) AS messages_count
      FROM places p
      LEFT JOIN place_stats ps ON ps.place_id = p.id
      WHERE ${conditions.join(" AND ")}
      LIMIT 2000
    `;

    const result = await query(sql, params);

    const features = result.rows.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [parseFloat(r.lon), parseFloat(r.lat)] },
      properties: {
        id: r.id,
        name: r.name,
        category: r.category || null,
        rating: r.rating ? parseFloat(r.rating) : null,
        messagesCount: parseInt(r.messages_count, 10),
      },
    }));

    return { type: "FeatureCollection", mode: "centroids", features };
  }

  // ── zoom >= 16: full polygons ────────────────────────────
  const params = [minLon, minLat, maxLon, maxLat];
  const conditions = [
    "ST_Intersects(p.geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))",
  ];

  if (category) {
    params.push(category);
    conditions.push(`p.category = $${params.length}`);
  }
  if (searchQuery) {
    params.push(searchQuery);
    conditions.push(`p.search_tsv @@ plainto_tsquery('simple', $${params.length})`);
  }

  const sql = `
    SELECT p.id, p.name, p.description, p.photos, p.source_url, p.category,
           ST_AsGeoJSON(p.geom)::json AS geometry,
           COALESCE(ps.rating_avg, 0) AS rating,
           COALESCE(ps.messages_count, 0) AS messages_count
    FROM places p
    LEFT JOIN place_stats ps ON ps.place_id = p.id
    WHERE ${conditions.join(" AND ")}
    LIMIT 500
  `;

  const result = await query(sql, params);

  const features = result.rows.map((r) => ({
    type: "Feature",
    geometry: r.geometry,
    properties: {
      id: r.id,
      name: r.name,
      category: r.category || null,
      rating: r.rating ? parseFloat(r.rating) : null,
      messagesCount: parseInt(r.messages_count, 10),
    },
  }));

  return { type: "FeatureCollection", mode: "polygons", features };
}

/**
 * Register cluster routes on Fastify.
 */
export default async function clustersRoutes(fastify) {
  fastify.get("/api/places/clusters", getClusters);
}
