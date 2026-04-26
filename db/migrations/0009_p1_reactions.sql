-- 0009_p1_reactions.sql
-- P1 F12: Message reactions (emoji).
-- Each user can give one reaction per message. Reactions are aggregated via JSONB on messages.

-- ── Reactions table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_reactions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       VARCHAR(8) NOT NULL,    -- e.g. '👍', '❤️', '😂', '🔥', '😮', '👎'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One reaction per user per message
  CONSTRAINT uq_reaction_user_message UNIQUE (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message
  ON message_reactions (message_id);

-- ── Add reactions JSONB column to messages for fast reads ──────
-- Format: { "👍": 3, "❤️": 1, "😂": 2 }
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}';

-- ── Trigger: auto-update messages.reactions on INSERT/UPDATE/DELETE ──
CREATE OR REPLACE FUNCTION sync_message_reactions()
RETURNS TRIGGER AS $$
DECLARE
  target_msg UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_msg := OLD.message_id;
  ELSE
    target_msg := NEW.message_id;
  END IF;

  UPDATE messages
  SET reactions = COALESCE((
    SELECT jsonb_object_agg(emoji, cnt)
    FROM (
      SELECT emoji, COUNT(*)::int AS cnt
      FROM message_reactions
      WHERE message_id = target_msg
      GROUP BY emoji
    ) sub
  ), '{}')
  WHERE id = target_msg;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_reactions_sync
  AFTER INSERT OR UPDATE OR DELETE ON message_reactions
  FOR EACH ROW EXECUTE FUNCTION sync_message_reactions();
