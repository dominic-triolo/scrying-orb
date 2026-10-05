-- Migration 011: Recall.ai ingest queue
-- Run this in your Railway Postgres console / Database tab.
--
-- The Recall webhook (web/app/api/recall/webhook) inserts one row per bot when
-- its transcript is ready; the Python synthesis worker polls this table alongside
-- the legacy Google Sheet and runs the same process_row() pipeline on each row.
--
-- status:
--   pending   webhook received transcript.done, worker hasn't processed it yet
--   complete  worker synthesized it into meetings
--   error     transcript.failed from Recall, or the worker raised (see notes)

-- ── shared updated_at trigger fn (idempotent) ───────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS recall_pending_meetings (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id        TEXT        NOT NULL UNIQUE,            -- Recall bot UUID (one row per bot)
  recording_id  TEXT,
  transcript_id TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'complete', 'error')),
  notes         TEXT,                                   -- error detail when status = 'error'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recall_pending_status
  ON recall_pending_meetings (status, created_at);

DROP TRIGGER IF EXISTS set_recall_pending_updated_at ON recall_pending_meetings;
CREATE TRIGGER set_recall_pending_updated_at
  BEFORE UPDATE ON recall_pending_meetings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
