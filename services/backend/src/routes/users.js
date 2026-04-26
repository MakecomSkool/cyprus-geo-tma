/**
 * services/backend/src/routes/users.js
 *
 * REST routes for user profile & favorites:
 *   GET    /api/users/me       — profile + stats + favorite IDs
 *   POST   /api/favorites      — add to favorites
 *   DELETE /api/favorites/:placeId — remove from favorites
 */

import { query } from "../db.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/users/me
 */
async function getProfile(request, reply) {
  const userId = request.userId;
  if (!userId) {
    return reply.code(401).send({ error: "Authentication required" });
  }

  // User data
  const userResult = await query(
    `SELECT id, telegram_id, username, first_name, last_name, avatar_url, created_at
     FROM users WHERE id = $1`,
    [userId]
  );

  if (userResult.rows.length === 0) {
    return reply.code(404).send({ error: "User not found" });
  }

  const user = userResult.rows[0];

  // Stats (from materialized view, fallback to inline query)
  let stats = { reviewsCount: 0, messagesCount: 0, favoritesCount: 0 };
  try {
    const statsResult = await query(
      `SELECT reviews_count, messages_count, favorites_count, avg_given_rating
       FROM user_stats WHERE user_id = $1`,
      [userId]
    );
    if (statsResult.rows.length > 0) {
      const s = statsResult.rows[0];
      stats = {
        reviewsCount: Number(s.reviews_count) || 0,
        messagesCount: Number(s.messages_count) || 0,
        favoritesCount: Number(s.favorites_count) || 0,
        avgGivenRating: s.avg_given_rating ? Number(s.avg_given_rating) : null,
      };
    }
  } catch {
    // Materialized view may not exist yet — use inline counts
    const inline = await query(
      `SELECT
        (SELECT COUNT(*) FROM reviews WHERE user_id = $1) AS reviews_count,
        (SELECT COUNT(*) FROM messages WHERE user_id = $1 AND deleted_at IS NULL) AS messages_count,
        (SELECT COUNT(*) FROM favorites WHERE user_id = $1) AS favorites_count`,
      [userId]
    );
    const s = inline.rows[0] || {};
    stats = {
      reviewsCount: Number(s.reviews_count) || 0,
      messagesCount: Number(s.messages_count) || 0,
      favoritesCount: Number(s.favorites_count) || 0,
    };
  }

  // Favorite place IDs
  const favsResult = await query(
    `SELECT place_id, list_type FROM favorites WHERE user_id = $1 ORDER BY added_at DESC`,
    [userId]
  );

  const favorites = favsResult.rows.map((r) => ({
    placeId: r.place_id,
    listType: r.list_type,
  }));

  // Compute "Local Expert" level
  const totalActivity = stats.reviewsCount * 3 + stats.messagesCount + stats.favoritesCount;
  const level = totalActivity >= 100 ? 5
    : totalActivity >= 50 ? 4
    : totalActivity >= 20 ? 3
    : totalActivity >= 5 ? 2
    : 1;
  const levelNames = ["", "Новичок", "Исследователь", "Знаток", "Эксперт", "Local Expert"];

  return {
    user: {
      id: user.id,
      telegramId: user.telegram_id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      avatarUrl: user.avatar_url,
      createdAt: user.created_at,
    },
    stats,
    level: { value: level, name: levelNames[level], progress: Math.min(totalActivity / 100, 1) },
    favorites,
  };
}

/**
 * POST /api/favorites
 * Body: { placeId: string, listType?: 'want' | 'visited' | 'loved' }
 */
async function addFavorite(request, reply) {
  const userId = request.userId;
  if (!userId) return reply.code(401).send({ error: "Authentication required" });

  const { placeId, listType = "loved" } = request.body || {};

  if (!placeId || !UUID_RE.test(placeId)) {
    return reply.code(400).send({ error: "Invalid placeId" });
  }

  if (!["want", "visited", "loved"].includes(listType)) {
    return reply.code(400).send({ error: "listType must be want, visited, or loved" });
  }

  // Verify place exists
  const placeCheck = await query("SELECT id FROM places WHERE id = $1", [placeId]);
  if (placeCheck.rows.length === 0) {
    return reply.code(404).send({ error: "Place not found" });
  }

  // UPSERT
  const result = await query(
    `INSERT INTO favorites (user_id, place_id, list_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, place_id) DO UPDATE SET
       list_type = EXCLUDED.list_type,
       added_at = NOW()
     RETURNING id, place_id, list_type, added_at`,
    [userId, placeId, listType]
  );

  return reply.code(201).send({
    favorite: {
      id: result.rows[0].id,
      placeId: result.rows[0].place_id,
      listType: result.rows[0].list_type,
      addedAt: result.rows[0].added_at,
    },
  });
}

/**
 * DELETE /api/favorites/:placeId
 */
async function removeFavorite(request, reply) {
  const userId = request.userId;
  if (!userId) return reply.code(401).send({ error: "Authentication required" });

  const { placeId } = request.params;
  if (!UUID_RE.test(placeId)) {
    return reply.code(400).send({ error: "Invalid placeId" });
  }

  await query(
    "DELETE FROM favorites WHERE user_id = $1 AND place_id = $2",
    [userId, placeId]
  );

  return { ok: true };
}

/**
 * Register user/favorites routes.
 */
export default async function usersRoutes(fastify) {
  fastify.get("/api/users/me", { preHandler: fastify.authenticate }, getProfile);
  fastify.post("/api/favorites", { preHandler: fastify.authenticate }, addFavorite);
  fastify.delete("/api/favorites/:placeId", { preHandler: fastify.authenticate }, removeFavorite);
}
