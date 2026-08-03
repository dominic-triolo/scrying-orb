-- Migration 009: drop the static meeting_type CHECK constraint on meetings.
--
-- meeting_types is a user-editable table (Settings → Meeting Types), so the set of
-- valid meeting types is dynamic. A hardcoded CHECK on meetings.meeting_type breaks
-- the insert whenever a type outside the original enum is used — e.g. the synthesis
-- worker resolving a HubSpot activity_type to 'post_launch', which is a real row in
-- meeting_types but was never in the CHECK list. The meeting_types table is the
-- source of truth for valid types; the static constraint is the wrong pattern here.

ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_meeting_type_check;
