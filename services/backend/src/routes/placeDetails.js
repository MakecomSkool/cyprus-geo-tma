/**
 * services/backend/src/routes/placeDetails.js
 *
 * GET /api/places/:id
 *
 * Returns full place details with stats, recent messages, and photos.
 */

import { query } from "../db.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_RE  = /^\d+$/;

async function getPlaceById(request, reply) {
  const { id } = request.params;

  const isUuid = UUID_RE.test(id);
  const isWikiId = INT_RE.test(id);

  if (!isUuid && !isWikiId) {
    return reply.code(400).send({ error: "Invalid place ID" });
  }

  // ── Main place + stats ──────────────────────────────────────
  const whereClause = isUuid
    ? "p.id = $1"
    : "p.wikimapia_id = $1";
  const paramValue = isUuid ? id : parseInt(id, 10);

  const placeResult = await query(
    `SELECT
       p.id,
       p.wikimapia_id,
       p.name,
       p.description,
       p.photos,
       p.source_url,
       p.category,
       p.subcategory,
       ST_Y(p.centroid) AS lat,
       ST_X(p.centroid) AS lon,
       p.created_at,
       p.updated_at,
       COALESCE(ps.reviews_count, 0)       AS reviews_count,
       ps.rating_avg,
       COALESCE(ps.rating_distribution, '{"1":0,"2":0,"3":0,"4":0,"5":0}'::jsonb) AS rating_distribution,
       COALESCE(ps.messages_count, 0)       AS messages_count,
       COALESCE(ps.photos_count, 0)         AS photos_count,
       ps.last_activity_at
     FROM places p
     LEFT JOIN place_stats ps ON ps.place_id = p.id
     WHERE ${whereClause}`,
    [paramValue]
  );

  if (placeResult.rows.length === 0) {
    return reply.code(404).send({ error: "Place not found" });
  }

  const row = placeResult.rows[0];

  // ── Recent messages (last 10, for preview in card) ──────────
  const msgsResult = await query(
    `SELECT
       m.id,
       m.body,
       m.reply_to_id,
       m.mentions,
       m.created_at,
       u.id         AS user_id,
       u.username,
       u.first_name,
       u.avatar_url
     FROM messages m
     JOIN users u ON u.id = m.user_id
     WHERE m.place_id = $1
       AND m.deleted_at IS NULL
     ORDER BY m.created_at DESC
     LIMIT 10`,
    [row.id]
  );

  const recentMessages = msgsResult.rows.map((m) => ({
    id: m.id,
    placeId: id,
    userId: m.user_id,
    user: {
      id: m.user_id,
      username: m.username,
      firstName: m.first_name,
      avatarUrl: m.avatar_url,
    },
    body: m.body,
    replyToId: m.reply_to_id || null,
    mentions: m.mentions || [],
    createdAt: m.created_at,
  }));

  // ── Build response ──────────────────────────────────────────
  return {
    id: row.id,
    wikimapiaId: row.wikimapia_id || null,
    name: row.name,
    description: row.description || null,
    photos: row.photos || [],
    sourceUrl: row.source_url || null,
    category: row.category || null,
    subcategory: row.subcategory || null,
    centroid: {
      lat: row.lat ? parseFloat(row.lat) : null,
      lon: row.lon ? parseFloat(row.lon) : null,
    },
    stats: {
      reviewsCount: parseInt(row.reviews_count, 10),
      ratingAvg: row.rating_avg ? parseFloat(row.rating_avg) : null,
      ratingDistribution: row.rating_distribution,
      messagesCount: parseInt(row.messages_count, 10),
      photosCount: parseInt(row.photos_count, 10),
      lastActivityAt: row.last_activity_at || null,
    },
    recentMessages,
    recentPhotos: (row.photos || []).slice(0, 6),
    isFavorited: false, // TODO: check user favorites when auth is wired
  };
}

export default async function placeDetailsRoutes(fastify) {
  fastify.get("/api/places/:id", getPlaceById);
}
