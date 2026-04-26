-- 0006_p1_reviews.sql
-- P1 Phase: Reviews & Ratings system.
-- Depends on: 0002 (users), 0003 (places), 0005 (place_stats).

-- ── Reviews table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  place_id    UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One review per user per place
  CONSTRAINT uq_reviews_user_place UNIQUE (user_id, place_id)
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reviews_place_id
  ON reviews (place_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_user_id
  ON reviews (user_id);

CREATE INDEX IF NOT EXISTS idx_reviews_rating
  ON reviews (place_id, rating);

-- ── Auto-update updated_at ────────────────────────────────────
CREATE TRIGGER trg_reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ── Trigger: auto-update place_stats on review INSERT ─────────
CREATE OR REPLACE FUNCTION fn_update_place_stats_on_review_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_count   INT;
  v_avg     NUMERIC(2,1);
  v_dist    JSONB;
BEGIN
  -- Compute aggregates for this place
  SELECT
    COUNT(*),
    ROUND(AVG(rating)::numeric, 1),
    jsonb_build_object(
      '1', COUNT(*) FILTER (WHERE rating = 1),
      '2', COUNT(*) FILTER (WHERE rating = 2),
      '3', COUNT(*) FILTER (WHERE rating = 3),
      '4', COUNT(*) FILTER (WHERE rating = 4),
      '5', COUNT(*) FILTER (WHERE rating = 5)
    )
  INTO v_count, v_avg, v_dist
  FROM reviews
  WHERE place_id = NEW.place_id;

  INSERT INTO place_stats (place_id, reviews_count, rating_avg, rating_distribution, last_activity_at)
  VALUES (NEW.place_id, v_count, v_avg, v_dist, NEW.created_at)
  ON CONFLICT (place_id) DO UPDATE SET
    reviews_count       = v_count,
    rating_avg          = v_avg,
    rating_distribution = v_dist,
    last_activity_at    = GREATEST(place_stats.last_activity_at, NEW.created_at),
    updated_at          = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_review_place_stats ON reviews;
CREATE TRIGGER trg_review_place_stats
  AFTER INSERT ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_place_stats_on_review_insert();

-- ── Trigger: auto-update place_stats on review UPDATE ─────────
CREATE OR REPLACE FUNCTION fn_update_place_stats_on_review_update()
RETURNS TRIGGER AS $$
DECLARE
  v_count   INT;
  v_avg     NUMERIC(2,1);
  v_dist    JSONB;
BEGIN
  SELECT
    COUNT(*),
    ROUND(AVG(rating)::numeric, 1),
    jsonb_build_object(
      '1', COUNT(*) FILTER (WHERE rating = 1),
      '2', COUNT(*) FILTER (WHERE rating = 2),
      '3', COUNT(*) FILTER (WHERE rating = 3),
      '4', COUNT(*) FILTER (WHERE rating = 4),
      '5', COUNT(*) FILTER (WHERE rating = 5)
    )
  INTO v_count, v_avg, v_dist
  FROM reviews
  WHERE place_id = NEW.place_id;

  UPDATE place_stats SET
    reviews_count       = v_count,
    rating_avg          = v_avg,
    rating_distribution = v_dist,
    updated_at          = NOW()
  WHERE place_id = NEW.place_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_review_update_stats ON reviews;
CREATE TRIGGER trg_review_update_stats
  AFTER UPDATE ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_place_stats_on_review_update();

-- ── Trigger: auto-update place_stats on review DELETE ─────────
CREATE OR REPLACE FUNCTION fn_update_place_stats_on_review_delete()
RETURNS TRIGGER AS $$
DECLARE
  v_count   INT;
  v_avg     NUMERIC(2,1);
  v_dist    JSONB;
BEGIN
  SELECT
    COUNT(*),
    ROUND(AVG(rating)::numeric, 1),
    jsonb_build_object(
      '1', COUNT(*) FILTER (WHERE rating = 1),
      '2', COUNT(*) FILTER (WHERE rating = 2),
      '3', COUNT(*) FILTER (WHERE rating = 3),
      '4', COUNT(*) FILTER (WHERE rating = 4),
      '5', COUNT(*) FILTER (WHERE rating = 5)
    )
  INTO v_count, v_avg, v_dist
  FROM reviews
  WHERE place_id = OLD.place_id;

  UPDATE place_stats SET
    reviews_count       = v_count,
    rating_avg          = COALESCE(v_avg, 0),
    rating_distribution = COALESCE(v_dist, '{"1":0,"2":0,"3":0,"4":0,"5":0}'::jsonb),
    updated_at          = NOW()
  WHERE place_id = OLD.place_id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_review_delete_stats ON reviews;
CREATE TRIGGER trg_review_delete_stats
  AFTER DELETE ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_place_stats_on_review_delete();
