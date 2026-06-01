-- Migration 007: Add 'no_show' to meetings status check constraint
ALTER TABLE meetings DROP CONSTRAINT meetings_status_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_status_check
  CHECK (status IN ('pending_synthesis', 'complete', 'error', 'no_show'));
