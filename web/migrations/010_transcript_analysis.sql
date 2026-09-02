-- Migration 010: cross-transcript analysis ("ask a question across many transcripts")
-- Run this in your Railway Postgres console / Database tab.
--
-- Leadership-only feature. A user submits a free-text question plus filters
-- (meeting types, reps, date range). A background thread in the Python synthesis
-- worker runs a map-reduce over the matching transcripts:
--   map    — per transcript, Gemini extracts findings + supporting quotes
--   reduce — Gemini synthesizes the findings into one quantified answer
-- The user can then chat follow-ups, answered over the stored findings.
--
-- Tables:
--   analysis_jobs      one row per submitted analysis (query + filters + status + result)
--   analysis_findings  one row per transcript analyzed (the map output), FK job + meeting
--   analysis_messages  chat history (reduce answer + follow-up Q&A) per job
--
-- Depends on the shared set_updated_at() trigger function (migrations 001-004).
-- Defined idempotently here too, so this migration is self-contained on a DB that
-- predates it (CREATE OR REPLACE is a no-op if the function already exists).

-- ── shared updated_at trigger fn (idempotent) ───────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── analysis_jobs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analysis_jobs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by        TEXT        NOT NULL,               -- email of the leadership user
  query             TEXT        NOT NULL,               -- the analysis question
  filters           JSONB       NOT NULL DEFAULT '{}',  -- {meeting_types:[], reps:[], date_from, date_to}
  status            TEXT        NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'complete', 'error', 'canceled')),
  total_transcripts INTEGER     NOT NULL DEFAULT 0,     -- matched transcript count at submit time
  processed_count   INTEGER     NOT NULL DEFAULT 0,     -- map progress (transcripts done)
  result            JSONB,                              -- reduce output {answer, stats, ...}
  error             TEXT,                               -- set when status = 'error'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at        TIMESTAMPTZ,                        -- when the worker picked it up
  finished_at       TIMESTAMPTZ,                        -- complete / error / canceled
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status
  ON analysis_jobs (status);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_creator
  ON analysis_jobs (created_by, created_at DESC);

DROP TRIGGER IF EXISTS set_analysis_jobs_updated_at ON analysis_jobs;
CREATE TRIGGER set_analysis_jobs_updated_at
  BEFORE UPDATE ON analysis_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── analysis_findings (the per-transcript map output) ───────────────────────
CREATE TABLE IF NOT EXISTS analysis_findings (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID        NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
  meeting_id  UUID        NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  findings    JSONB       NOT NULL DEFAULT '{}',  -- per-transcript extraction + key quotes
  error       TEXT,                               -- set if this transcript's map failed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, meeting_id)                     -- idempotent re-runs / resumability
);

CREATE INDEX IF NOT EXISTS idx_analysis_findings_job
  ON analysis_findings (job_id);

-- ── analysis_messages (chat history) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analysis_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID        NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_messages_job
  ON analysis_messages (job_id, created_at);
