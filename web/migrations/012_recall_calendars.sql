-- Migration 012: Recall.ai calendar connections (notetaker auto-join)
-- Run this in your Railway Postgres console / Database tab.
--
-- One row per rep who clicked "Connect calendar" in the orb. The calendar itself
-- (and its Google refresh token) lives in Recall; this table maps our user to it
-- and carries the sync watermark between the web app and the worker:
--
--   web     calendar.sync_events webhook → sets sync_from / sync_requested_at
--   worker  calendar-sync thread → lists events changed since sync_from, schedules
--           or unschedules a bot per event, then clears sync_from
--
-- sync_from IS NOT NULL means "a sync is owed". sync_requested_at is the token the
-- worker checks before clearing, so a webhook that lands mid-sync isn't lost.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS recall_calendars (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT        NOT NULL UNIQUE,        -- orb user (lower-cased)
  recall_calendar_id TEXT        NOT NULL UNIQUE,        -- Recall calendar UUID
  status             TEXT        NOT NULL DEFAULT 'connected',  -- mirrors Recall: connecting | connected | disconnected
  sync_from          TIMESTAMPTZ,                        -- oldest unprocessed change; NULL = nothing owed
  sync_requested_at  TIMESTAMPTZ,                        -- bumped on every sync request
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recall_calendars_sync
  ON recall_calendars (sync_requested_at) WHERE sync_from IS NOT NULL;

DROP TRIGGER IF EXISTS set_recall_calendars_updated_at ON recall_calendars;
CREATE TRIGGER set_recall_calendars_updated_at
  BEFORE UPDATE ON recall_calendars
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
