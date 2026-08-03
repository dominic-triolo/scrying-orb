-- Migration 008: legacy imported meetings (attention.io backfill)
--
-- 'legacy' status: meetings imported from attention.io that are shown to reps but
-- NOT synthesized until a rep explicitly requests it. The Python synthesis worker
-- only ever selects status='pending_synthesis' (background) or reads the handoff
-- Sheet, so 'legacy' rows are invisible to it — nothing auto-synthesizes and nothing
-- emits to the nurture tool. On-demand synthesis (web /api/meetings/[id]/synthesize)
-- flips them to 'complete'.
--
-- import_source: tags where a meeting came from ('attention' for this backfill).
-- Used to badge legacy rows and to keep them out of the nurture pipeline if their
-- type is later edited (the re-synth emit skips import_source='attention').

ALTER TABLE meetings DROP CONSTRAINT meetings_status_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_status_check
  CHECK (status IN ('pending_synthesis', 'complete', 'error', 'no_show', 'legacy'));

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS import_source TEXT;
