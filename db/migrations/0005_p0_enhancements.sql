-- 0005_p0_enhancements.sql
-- P0 Phase: centroid, category, full-text search, place_stats, message replies.
-- Depends on: 0001 (extensions), 0003 (places), 0004 (messages).

-- ── pg_trgm for fuzzy search ─────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Places: add centroid, category, full-text search ─────────
ALTER TABLE places
  ADD COLUMN IF NOT EXISTS category    VARCHAR(40),
  ADD COLUMN IF NOT EXISTS subcategory VARCHAR(60);

-- Centroid as a GENERATED column from geom (for clustering / markers)
-- NOTE: PostGIS ST_Centroid returns GEOMETRY, we cast to GEOGRAPHY for distance ops.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'places' AND column_name = 'centroid'
  ) THEN
    ALTER TABLE places
      ADD COLUMN centroid GEOMETRY(POINT, 4326)
      GENERATED ALWAYS AS (ST_Centroid(geom)) STORED;
  END IF;
END $$;

-- Full-text search vector (name=A weight, description=B weight)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'places' AND column_name = 'search_tsv'
  ) THEN
    ALTER TABLE places
      ADD COLUMN search_tsv tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(description, '')), 'B')
      ) STORED;
  END IF;
END $$;

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_places_centroid
  ON places USING GIST (centroid);

CREATE INDEX IF NOT EXISTS idx_places_search
  ON places USING GIN (search_tsv);

CREATE INDEX IF NOT EXISTS idx_places_category
  ON places (category)
  WHERE category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_places_name_trgm
  ON places USING GIN (name gin_trgm_ops);

-- ── Place stats (denormalized aggregates for fast card render) ─
CREATE TABLE IF NOT EXISTS place_stats (
  place_id             UUID PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
  reviews_count        INT NOT NULL DEFAULT 0,
  rating_avg           NUMERIC(2,1),
  rating_distribution  JSONB NOT NULL DEFAULT '{"1":0,"2":0,"3":0,"4":0,"5":0}'::jsonb,
  messages_count       INT NOT NULL DEFAULT 0,
  photos_count         INT NOT NULL DEFAULT 0,
  last_activity_at     TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Messages: add reply, mentions, soft-delete ────────────────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id),
  ADD COLUMN IF NOT EXISTS mentions    BIGINT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to
  ON messages (reply_to_id)
  WHERE reply_to_id IS NOT NULL;

-- ── Constraint: message body max length ───────────────────────
ALTER TABLE messages
  ADD CONSTRAINT chk_message_body_length CHECK (length(body) <= 2000);

-- ── Deep link analytics ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS deeplink_hits (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES users(id),
  place_id   UUID REFERENCES places(id),
  start_param TEXT,
  hit_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Trigger: auto-update place_stats on new message ───────────
CREATE OR REPLACE FUNCTION fn_update_place_stats_on_message()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO place_stats (place_id, messages_count, last_activity_at)
  VALUES (NEW.place_id, 1, NEW.created_at)
  ON CONFLICT (place_id) DO UPDATE SET
    messages_count   = place_stats.messages_count + 1,
    last_activity_at = GREATEST(place_stats.last_activity_at, NEW.created_at),
    updated_at       = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_msg_place_stats ON messages;
CREATE TRIGGER trg_msg_place_stats
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_place_stats_on_message();

-- ── Backfill place_stats from existing messages ───────────────
INSERT INTO place_stats (place_id, messages_count, last_activity_at)
SELECT place_id, COUNT(*), MAX(created_at)
FROM messages
WHERE deleted_at IS NULL
GROUP BY place_id
ON CONFLICT (place_id) DO UPDATE SET
  messages_count   = EXCLUDED.messages_count,
  last_activity_at = EXCLUDED.last_activity_at,
  updated_at       = NOW();
