-- 0004_messages.sql
-- Messages table: geo-social messages attached to places.

CREATE TABLE IF NOT EXISTS messages (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    place_id      UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body          TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Composite index: messages for a place, newest first
CREATE INDEX IF NOT EXISTS idx_messages_place_created
    ON messages (place_id, created_at DESC);

-- ── Fast lookup by user (for "my messages" view)
CREATE INDEX IF NOT EXISTS idx_messages_user_id
    ON messages (user_id);
