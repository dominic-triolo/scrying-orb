-- Migration 005: meeting_types table
-- Run each statement individually in Railway's Postgres console.

CREATE TABLE meeting_types (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  scoreable   BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO meeting_types (id, label, scoreable, sort_order) VALUES
  ('intro',    'Intro Call',    true,  1),
  ('planning', 'Planning Call', true,  2),
  ('nurture',  'Nurture',       false, 3);
