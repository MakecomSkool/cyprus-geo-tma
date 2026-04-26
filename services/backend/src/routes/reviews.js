/**
 * services/backend/src/routes/reviews.js
 *
 * REST routes for place reviews:
 *   GET  /api/places/:id/reviews — paginated list with stats
 *   POST /api/places/:id/reviews — create or update review
 */

import { query } from "../db.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/places/:id/reviews?cursor=<ISO>&limit=20&sort=recent|highest|lowest
 */
async function getReviews(request, reply) {
  const { id } = request.params;
  if (!UUID_RE.test(id)) {
    return reply.code(400).send({ error: "Invalid place ID format (expected UUID)" });
  }

  const limit = Math.min(Math.max(parseInt(request.query.limit || "20", 10), 1), 50);
  const cursor = request.query.cursor || null;
  const sort = request.query.sort || "recent";

  // Determine ORDER BY
  let orderClause;
  switch (sort) {
    case "highest":
      orderClause = "r.rating DESC, r.created_at DESC";
      break;
    case "lowest":
      orderClause = "r.rating ASC, r.created_at DESC";
      break;
    default:
      orderClause = "r.created_at DESC";
  }

  // Build query
  const params = [id];
  let cursorClause = "";
  if (cursor) {
    params.push(cursor);
    cursorClause = `AND r.created_at < $${params.length}`;
  }
  params.push(limit + 1);

  const result = await query(
    `SELECT
       r.id,
       r.rating,
       r.body,
       r.created_at,
       r.updated_at,
       u.id AS user_id,
       u.telegram_id,
       u.username,
       u.first_name,
       u.avatar_url
     FROM reviews r
     JOIN users u ON u.id = r.user_id
     WHERE r.place_id = $1
       ${cursorClause}
     ORDER BY ${orderClause}
     LIMIT $${params.length}`,
    params
  );

  const hasMore = result.rows.length > limit;
  const reviews = result.rows.slice(0, limit).map((row) => ({
    id: row.id,
    placeId: id,
    rating: row.rating,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    user: {
      id: row.user_id,
      username: row.username,
      firstName: row.first_name,
      avatarUrl: row.avatar_url,
    },
  }));

  const nextCursor = hasMore
    ? reviews[reviews.length - 1].createdAt
    : null;

  // Fetch place_stats for this place
  const statsResult = await query(
    `SELECT
       reviews_count,
       rating_avg,
       rating_distribution,
       messages_count,
       photos_count,
       last_activity_at
     FROM place_stats
     WHERE place_id = $1`,
    [id]
  );

  const statsRow = statsResult.rows[0] || {};
  const stats = {
    reviewsCount: statsRow.reviews_count || 0,
    ratingAvg: statsRow.rating_avg ? Number(statsRow.rating_avg) : null,
    ratingDistribution: statsRow.rating_distribution || { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
    messagesCount: statsRow.messages_count || 0,
    photosCount: statsRow.photos_count || 0,
    lastActivityAt: statsRow.last_activity_at || null,
  };

  return {
    reviews,
    nextCursor,
    hasMore,
    count: reviews.length,
    stats,
  };
}

/**
 * POST /api/places/:id/reviews
 * Body: { rating: 1-5, body?: string }
 *
 * Uses UPSERT: one review per user per place (updates if exists).
 */
async function createReview(request, reply) {
  const { id: placeId } = request.params;
  if (!UUID_RE.test(placeId)) {
    return reply.code(400).send({ error: "Invalid place ID format (expected UUID)" });
  }

  const { rating, body } = request.body || {};

  // Validate rating
  if (!rating || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return reply.code(400).send({ error: "Rating must be an integer between 1 and 5" });
  }

  // Validate body length
  const reviewText = typeof body === "string" ? body.trim() : "";
  if (reviewText.length > 2000) {
    return reply.code(400).send({ error: "Review text must be 2000 characters or less" });
  }

  // Get user from request (set by auth middleware)
  const userId = request.userId;
  if (!userId) {
    return reply.code(401).send({ error: "Authentication required" });
  }

  // Verify place exists
  const placeCheck = await query(
    "SELECT id FROM places WHERE id = $1",
    [placeId]
  );
  if (placeCheck.rows.length === 0) {
    return reply.code(404).send({ error: "Place not found" });
  }

  // UPSERT: insert or update
  const result = await query(
    `INSERT INTO reviews (place_id, user_id, rating, body)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, place_id) DO UPDATE SET
       rating     = EXCLUDED.rating,
       body       = EXCLUDED.body,
       updated_at = NOW()
     RETURNING id, rating, body, created_at, updated_at`,
    [placeId, userId, rating, reviewText]
  );

  const row = result.rows[0];

  // Fetch user info
  const userResult = await query(
    "SELECT id, username, first_name, avatar_url FROM users WHERE id = $1",
    [userId]
  );
  const user = userResult.rows[0] || {};

  return reply.code(201).send({
    review: {
      id: row.id,
      placeId,
      rating: row.rating,
      body: row.body,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      user: {
        id: user.id,
        username: user.username,
        firstName: user.first_name,
        avatarUrl: user.avatar_url,
      },
    },
  });
}

/**
 * Register review routes on Fastify instance.
 */
export default async function reviewsRoutes(fastify) {
  fastify.get("/api/places/:id/reviews", getReviews);
  fastify.post("/api/places/:id/reviews", {
    preHandler: fastify.authenticate,
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, createReview);
}
