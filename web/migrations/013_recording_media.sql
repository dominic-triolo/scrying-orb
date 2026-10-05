-- Migration 013: notetaker recordings in our own bucket
-- Run this in your Railway Postgres console / Database tab.
--
-- After a Recall bot's meeting is synthesized, the worker's media-copy thread
-- copies the video (and the raw word-level transcript JSON) from Recall into our
-- Cloudflare R2 bucket, then points the meeting at the object.
--
-- meetings.recording_key          object key of the video in the bucket; the meeting
--                                 page plays it through /api/meetings/[id]/recording
-- recall_pending_meetings.media_status
--   pending   not copied yet (also the state while the bucket isn't configured)
--   copied    video + transcript JSON are in the bucket and verified
--   none      the bot produced no video (e.g. never admitted to the call)
--   error     copy failed (see media_notes); retried until media_attempts runs out

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS recording_key TEXT;

ALTER TABLE recall_pending_meetings
  ADD COLUMN IF NOT EXISTS media_status   TEXT    NOT NULL DEFAULT 'pending'
    CHECK (media_status IN ('pending', 'copied', 'none', 'error')),
  ADD COLUMN IF NOT EXISTS media_notes    TEXT,
  ADD COLUMN IF NOT EXISTS media_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_recall_pending_media
  ON recall_pending_meetings (media_status, created_at) WHERE status = 'complete';
