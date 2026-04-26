-- 0008_p1_favorites_profile.sql
-- P1: Favorites lists + user statistics view.
-- Depends on: 0002 (users), 0003 (places).

-- ── Favorites table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorites (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id   UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  list_type  VARCHAR(20) NOT NULL DEFAULT 'loved'
             CHECK (list_type IN ('want', 'visited', 'loved')),
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One entry per user + place
  CONSTRAINT uq_favorites_user_place UNIQUE (user_id, place_id)
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_favorites_user
  ON favorites (user_id, added_at DESC);

CREATE INDEX IF NOT EXISTS idx_favorites_place
  ON favorites (place_id);

CREATE INDEX IF NOT EXISTS idx_favorites_list_type
  ON favorites (user_id, list_type);

-- ── User stats view ──────────────────────────────────────────
-- Materialized view for fast profile rendering.
CREATE MATERIALIZED VIEW IF NOT EXISTS user_stats AS
SELECT
  u.id AS user_id,
  COALESCE(rv.cnt, 0)   AS reviews_count,
  COALESCE(msg.cnt, 0)  AS messages_count,
  COALESCE(fav.cnt, 0)  AS favorites_count,
  COALESCE(rv.avg_r, 0) AS avg_given_rating
FROM users u
LEFT JOIN (
  SELECT user_id, COUNT(*) AS cnt, ROUND(AVG(rating)::numeric, 1) AS avg_r
  FROM reviews
  GROUP BY user_id
) rv ON rv.user_id = u.id
LEFT JOIN (
  SELECT user_id, COUNT(*) AS cnt
  FROM messages
  WHERE deleted_at IS NULL
  GROUP BY user_id
) msg ON msg.user_id = u.id
LEFT JOIN (
  SELECT user_id, COUNT(*) AS cnt
  FROM favorites
  GROUP BY user_id
) fav ON fav.user_id = u.id;

-- Unique index for REFRESH CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_stats_user_id
  ON user_stats (user_id);

-- ── Helper function to refresh user_stats ─────────────────────
CREATE OR REPLACE FUNCTION refresh_user_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY user_stats;
END;
$$ LANGUAGE plpgsql;
