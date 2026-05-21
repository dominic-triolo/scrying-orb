-- Migration 004: Scoring / Coaching system
-- Run this in your Railway Postgres console or psql

-- Scorecards: one per supported meeting type (intro, planning)
CREATE TABLE IF NOT EXISTS scorecards (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_type      TEXT        NOT NULL UNIQUE CHECK (meeting_type IN ('intro', 'planning')),
  min_score         NUMERIC     NOT NULL DEFAULT 1,
  mid_score         NUMERIC     NOT NULL DEFAULT 3,
  max_score         NUMERIC     NOT NULL DEFAULT 5,
  formatting_prompt TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_scorecards_updated_at
  BEFORE UPDATE ON scorecards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Rubric sections per scorecard
CREATE TABLE IF NOT EXISTS scorecard_sections (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_id    UUID        NOT NULL REFERENCES scorecards(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  description_min TEXT,
  description_mid TEXT,
  description_max TEXT,
  weight          NUMERIC,          -- NULL = equal weight (treated as 1)
  sort_order      INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scorecard_sections_scorecard_id_idx
  ON scorecard_sections(scorecard_id);

-- Per-meeting AI-generated scores
CREATE TABLE IF NOT EXISTS meeting_scores (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id       UUID        NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  section_scores   JSONB       NOT NULL DEFAULT '[]',
  overall_score    NUMERIC,
  coaching_output  TEXT,
  max_score        NUMERIC     NOT NULL DEFAULT 5,  -- snapshot from scorecard at time of scoring
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (meeting_id)
);

CREATE TRIGGER set_meeting_scores_updated_at
  BEFORE UPDATE ON meeting_scores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
