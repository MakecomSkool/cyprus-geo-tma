/**
 * services/backend/src/routes/places.js
 * REST routes for places (spatial queries).
 */

import { query } from "../db.js";

/**
 * GET /api/places?bbox=minLon,minLat,maxLon,maxLat
 *
 * Returns a GeoJSON FeatureCollection of places within the bounding box.
 * Uses PostGIS ST_Intersects + ST_MakeEnvelope for spatial filtering.
 */
async function getPlaces(request, reply) {
  const { bbox } = request.query;

  if (!bbox) {
    return reply.code(400).send({
      error: "Missing required query parameter: bbox",
      example: "/api/places?bbox=33.3,35.1,33.4,35.2",
    });
  }

  const parts = bbox.split(",").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    return reply.code(400).send({
      error: "Invalid bbox format. Expected: minLon,minLat,maxLon,maxLat",
      example: "/api/places?bbox=33.3,35.1,33.4,35.2",
    });
  }

  const [minLon, minLat, maxLon, maxLat] = parts;

  // Basic range validation
  if (minLon >= maxLon || minLat >= maxLat) {
    return reply.code(400).send({
      error: "Invalid bbox: min values must be less than max values",
    });
  }

  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
    return reply.code(400).send({
      error: "Invalid bbox: coordinates out of range (lon: -180..180, lat: -90..90)",
    });
  }

  const result = await query(
    `SELECT
       p.id,
       p.wikimapia_id,
       p.name,
       p.description,
       p.photos,
       p.source_url,
       ST_AsGeoJSON(p.geom)::json AS geometry,
       p.created_at,
       p.updated_at
     FROM places p
     WHERE ST_Intersects(
       p.geom,
       ST_MakeEnvelope($1, $2, $3, $4, 4326)
     )
     LIMIT 500`,
    [minLon, minLat, maxLon, maxLat]
  );

  const features = result.rows.map((row) => ({
    type: "Feature",
    geometry: row.geometry,
    properties: {
      id: row.id,
      wikimapia_id: row.wikimapia_id,
      name: row.name,
      description: row.description,
      photos: row.photos,
      source_url: row.source_url,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  }));

  return {
    type: "FeatureCollection",
    features,
    bbox: [minLon, minLat, maxLon, maxLat],
    count: features.length,
  };
}

/**
 * GET /api/places/:id/messages?cursor=<ISO timestamp>&limit=50
 *
 * Keyset pagination over messages for a specific place.
 * Ordered by created_at DESC (newest first).
 * Uses the composite index (place_id, created_at DESC).
 */
async function getPlaceMessages(request, reply) {
  const { id } = request.params;
  const limit = Math.min(Math.max(parseInt(request.query.limit || "50", 10), 1), 100);
  const cursor = request.query.cursor || null;

  // UUID format check
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return reply.code(400).send({ error: "Invalid place ID format (expected UUID)" });
  }

  let result;
  if (cursor) {
    result = await query(
      `SELECT
         m.id,
         m.body,
         m.reply_to_id,
         m.mentions,
         m.created_at,
         u.id AS user_id,
         u.telegram_id,
         u.username,
         u.first_name,
         u.last_name,
         u.avatar_url
       FROM messages m
       JOIN users u ON u.id = m.user_id
       WHERE m.place_id = $1
         AND m.created_at < $2
         AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC
       LIMIT $3`,
      [id, cursor, limit + 1] // +1 to detect if there are more
    );
  } else {
    result = await query(
      `SELECT
         m.id,
         m.body,
         m.reply_to_id,
         m.mentions,
         m.created_at,
         u.id AS user_id,
         u.telegram_id,
         u.username,
         u.first_name,
         u.last_name,
         u.avatar_url
       FROM messages m
       JOIN users u ON u.id = m.user_id
       WHERE m.place_id = $1
         AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC
       LIMIT $2`,
      [id, limit + 1]
    );
  }

  const hasMore = result.rows.length > limit;
  const messages = result.rows.slice(0, limit).map((row) => ({
    id: row.id,
    body: row.body,
    replyToId: row.reply_to_id || null,
    mentions: row.mentions || [],
    createdAt: row.created_at,
    user: {
      id: row.user_id,
      username: row.username,
      firstName: row.first_name,
      avatarUrl: row.avatar_url,
    },
  }));

  const nextCursor = hasMore
    ? messages[messages.length - 1].created_at.toISOString()
    : null;

  return {
    messages,
    next_cursor: nextCursor,
    has_more: hasMore,
    count: messages.length,
  };
}

/**
 * Register places routes on Fastify instance.
 */
export default async function placesRoutes(fastify) {
  // Public: no auth required for browsing places
  fastify.get("/api/places", getPlaces);
  fastify.get("/api/places/:id/messages", getPlaceMessages);
}
