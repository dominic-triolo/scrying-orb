-- Migration 006: Add meeting_outcome column
-- Stores the HubSpot hs_meeting_outcome value (e.g. COMPLETED, NO_SHOW, CANCELLED)

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS meeting_outcome TEXT;
