import json
import logging
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

from config import Config

logger = logging.getLogger(__name__)

# Register UUID adapter so psycopg2 returns UUIDs as strings
psycopg2.extras.register_uuid()


class DBClient:
    def __init__(self, config: Config):
        self._dsn = config.database_url

    def _connect(self):
        return psycopg2.connect(self._dsn)

    def upsert_meeting(
        self,
        row: dict,
        meeting_type: str,
        meeting_type_source: str,
        synthesis: dict,
        talk_ratio: dict,
        hubspot_deal_id: str | None = None,
        transcript_text: str | None = None,
        meeting_outcome: str | None = None,
        skip_synthesis: bool = False,
    ) -> str:
        """
        Insert or update the meeting row. Returns the meetings.id (UUID string).
        Upserts on pairing_key so retries are safe.
        """
        now = datetime.now(timezone.utc)

        # Parse meeting_datetime from sheet value if present
        meeting_datetime = None
        raw_dt = row.get("meeting_datetime", "")
        if raw_dt:
            try:
                meeting_datetime = datetime.fromisoformat(raw_dt.replace("Z", "+00:00"))
            except ValueError:
                pass

        # Meetings without synthesis (e.g. NO_SHOW) get a distinct status
        status = "no_show" if skip_synthesis and meeting_outcome else "complete"
        synthesized_at = None if skip_synthesis else now

        sql = """
            INSERT INTO meetings (
                pairing_key, meeting_name, meeting_datetime,
                transcript_copy_id, recording_file_id, recording_owner,
                hubspot_deal_id,
                meeting_type, meeting_type_source,
                synthesis_output, rep_talk_pct, prospect_talk_pct,
                transcript_text, meeting_outcome,
                status, processed_at, synthesized_at
            ) VALUES (
                %(pairing_key)s, %(meeting_name)s, %(meeting_datetime)s,
                %(transcript_copy_id)s, %(recording_file_id)s, %(recording_owner)s,
                %(hubspot_deal_id)s,
                %(meeting_type)s, %(meeting_type_source)s,
                %(synthesis_output)s, %(rep_talk_pct)s, %(prospect_talk_pct)s,
                %(transcript_text)s, %(meeting_outcome)s,
                %(status)s, %(processed_at)s, %(synthesized_at)s
            )
            ON CONFLICT (pairing_key) DO UPDATE SET
                meeting_type        = EXCLUDED.meeting_type,
                meeting_type_source = EXCLUDED.meeting_type_source,
                synthesis_output    = EXCLUDED.synthesis_output,
                rep_talk_pct        = EXCLUDED.rep_talk_pct,
                prospect_talk_pct   = EXCLUDED.prospect_talk_pct,
                transcript_text     = EXCLUDED.transcript_text,
                meeting_outcome     = COALESCE(EXCLUDED.meeting_outcome, meetings.meeting_outcome),
                hubspot_deal_id     = COALESCE(EXCLUDED.hubspot_deal_id, meetings.hubspot_deal_id),
                status              = EXCLUDED.status,
                synthesized_at      = EXCLUDED.synthesized_at
            RETURNING id
        """

        params = {
            "pairing_key":        row["pairing_key"],
            "meeting_name":       row["meeting_name"],
            "meeting_datetime":   meeting_datetime,
            "transcript_copy_id": row.get("transcript_copy_id"),
            "recording_file_id":  row.get("recording_file_id") or None,
            "recording_owner":    row.get("recording_owner") or None,
            "hubspot_deal_id":    hubspot_deal_id,
            "meeting_type":       meeting_type,
            "meeting_type_source": meeting_type_source,
            "synthesis_output":   psycopg2.extras.Json(synthesis),
            "rep_talk_pct":       talk_ratio.get("rep_talk_pct"),
            "prospect_talk_pct":  talk_ratio.get("prospect_talk_pct"),
            "transcript_text":    transcript_text,
            "meeting_outcome":    meeting_outcome,
            "status":             status,
            "processed_at":       row.get("processed_at") or now,
            "synthesized_at":     synthesized_at,
        }

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                meeting_id = str(cur.fetchone()[0])
                conn.commit()

        logger.info(f"Upserted meeting {meeting_id} ({row['pairing_key']})")
        return meeting_id

    def get_pending_resynthesis(self) -> list[dict]:
        """
        Return meetings that need re-synthesis due to a manual type change.
        These already have transcript_text stored, so no Drive read is needed.

        Selects the full set of fields the nurture emit needs (not just what
        re-synthesis itself uses) so a manual type correction can be pushed to
        the nurture tool after re-synthesis.
        """
        sql = """
            SELECT id, pairing_key, meeting_name, meeting_datetime,
                   meeting_type, meeting_type_source, meeting_outcome,
                   transcript_text, recording_owner, hubspot_deal_id,
                   import_source
            FROM meetings
            WHERE status = 'pending_synthesis'
              AND transcript_text IS NOT NULL
            ORDER BY updated_at ASC
            LIMIT 10
        """
        with self._connect() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql)
                return [dict(r) for r in cur.fetchall()]

    def get_contacts(self, meeting_id: str) -> list[dict]:
        """
        Fetch stored contacts for a meeting, shaped for the nurture emit
        (email / hubspot_contact_id / deals). Used by the re-synthesis emit,
        which — unlike process_row — has no in-memory contacts to hand.
        """
        sql = """
            SELECT email, hubspot_contact_id, deals
            FROM meeting_contacts
            WHERE meeting_id = %(id)s
        """
        with self._connect() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, {"id": meeting_id})
                rows = [dict(r) for r in cur.fetchall()]
        # deals is stored via json.dumps; normalize to a list whether the column
        # comes back parsed (jsonb) or as a raw string (text).
        for r in rows:
            d = r.get("deals")
            if isinstance(d, str):
                try:
                    r["deals"] = json.loads(d)
                except (ValueError, TypeError):
                    r["deals"] = []
            elif d is None:
                r["deals"] = []
        return rows

    def complete_resynthesis(
        self,
        meeting_id: str,
        synthesis: dict,
        talk_ratio: dict,
    ) -> None:
        """
        Write re-synthesis results back and mark the meeting complete.
        """
        now = datetime.now(timezone.utc)
        sql = """
            UPDATE meetings SET
                synthesis_output  = %(synthesis_output)s,
                rep_talk_pct      = %(rep_talk_pct)s,
                prospect_talk_pct = %(prospect_talk_pct)s,
                status            = 'complete',
                synthesized_at    = %(synthesized_at)s
            WHERE id = %(id)s
        """
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, {
                    "id":               meeting_id,
                    "synthesis_output": psycopg2.extras.Json(synthesis),
                    "rep_talk_pct":     talk_ratio.get("rep_talk_pct"),
                    "prospect_talk_pct": talk_ratio.get("prospect_talk_pct"),
                    "synthesized_at":   now,
                })
                conn.commit()
        logger.info(f"Re-synthesis complete for meeting {meeting_id}")

    def get_meeting_type_id_by_label(self, label: str) -> str | None:
        """
        Look up a meeting type ID by its label (case-insensitive).
        Used to convert hs_activity_type strings (e.g. "Intro Call") to
        internal IDs (e.g. "intro").
        Returns None if no matching type is configured.
        """
        sql = "SELECT id FROM meeting_types WHERE LOWER(label) = LOWER(%s) LIMIT 1"
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (label,))
                row = cur.fetchone()
                return str(row[0]) if row else None

    def upsert_contacts(self, meeting_id: str, contacts: list[dict]) -> None:
        """
        Insert or update meeting_contacts rows for all resolved external participants.
        """
        if not contacts:
            return

        sql = """
            INSERT INTO meeting_contacts (meeting_id, email, hubspot_contact_id, deals)
            VALUES %s
            ON CONFLICT (meeting_id, email) DO UPDATE SET
                hubspot_contact_id = COALESCE(EXCLUDED.hubspot_contact_id, meeting_contacts.hubspot_contact_id),
                deals = EXCLUDED.deals
        """

        values = tuple(
            (
                meeting_id,
                c["email"],
                c.get("hubspot_contact_id"),
                json.dumps(c.get("deals", [])),
            )
            for c in contacts
        )

        with self._connect() as conn:
            with conn.cursor() as cur:
                psycopg2.extras.execute_values(cur, sql, values)
                conn.commit()

        logger.info(f"Upserted {len(contacts)} contact(s) for meeting {meeting_id}")

    # ── Cross-transcript analysis (migration 010) ───────────────────────────
    #
    # The analyzable set is: transcript stored AND the call actually happened.
    # Kept identical to the web /estimate count so the "N transcripts" the user
    # confirms is exactly what the worker processes.
    _ANALYZABLE_WHERE = (
        "transcript_text IS NOT NULL AND status IN ('complete', 'legacy')"
    )

    def claim_next_analysis_job(self) -> dict | None:
        """Atomically claim one queued analysis job (running + started_at).

        FOR UPDATE SKIP LOCKED makes this safe even if more than one worker ever
        runs. Returns the job dict, or None when the queue is empty.
        """
        sql = f"""
            UPDATE analysis_jobs SET status = 'running', started_at = NOW()
            WHERE id = (
                SELECT id FROM analysis_jobs
                WHERE status = 'queued'
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, query, filters, total_transcripts, processed_count
        """
        with self._connect() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql)
                row = cur.fetchone()
                conn.commit()
                return dict(row) if row else None

    def fetch_analysis_meetings(self, filters: dict) -> list[dict]:
        """Meetings matching the job's filters that have an analyzable transcript.

        filters: {meeting_types: [...], reps: [...], date_from, date_to} — any
        empty/absent list or null bound is treated as "no filter" for that field.
        """
        types = filters.get("meeting_types") or None
        reps = filters.get("reps") or None
        date_from = filters.get("date_from") or None
        date_to = filters.get("date_to") or None
        sql = f"""
            SELECT id, meeting_name, meeting_datetime, recording_owner,
                   meeting_type, transcript_text
            FROM meetings
            WHERE {self._ANALYZABLE_WHERE}
              AND (%(types)s::text[]  IS NULL OR meeting_type    = ANY(%(types)s))
              AND (%(reps)s::text[]   IS NULL OR recording_owner = ANY(%(reps)s))
              AND (%(date_from)s::date IS NULL OR meeting_datetime >= %(date_from)s::date)
              AND (%(date_to)s::date   IS NULL OR meeting_datetime <  (%(date_to)s::date + INTERVAL '1 day'))
            ORDER BY meeting_datetime ASC NULLS LAST
        """
        params = {"types": types, "reps": reps, "date_from": date_from, "date_to": date_to}
        with self._connect() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, params)
                return [dict(r) for r in cur.fetchall()]

    def analysis_done_meeting_ids(self, job_id: str) -> set[str]:
        """meeting_ids already mapped for this job (resume after a crash/restart)."""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT meeting_id FROM analysis_findings WHERE job_id = %s", (job_id,)
                )
                return {str(r[0]) for r in cur.fetchall()}

    def save_analysis_finding(
        self, job_id: str, meeting_id: str, findings: dict, error: str | None = None
    ) -> None:
        """Upsert one transcript's map output (idempotent on job_id + meeting_id)."""
        sql = """
            INSERT INTO analysis_findings (job_id, meeting_id, findings, error)
            VALUES (%(job_id)s, %(meeting_id)s, %(findings)s, %(error)s)
            ON CONFLICT (job_id, meeting_id) DO UPDATE SET
                findings = EXCLUDED.findings,
                error    = EXCLUDED.error
        """
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, {
                    "job_id": job_id,
                    "meeting_id": meeting_id,
                    "findings": psycopg2.extras.Json(findings),
                    "error": error,
                })
                conn.commit()

    def bump_analysis_progress(self, job_id: str, delta: int = 1) -> None:
        """Atomically advance processed_count (map threads increment concurrently)."""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE analysis_jobs SET processed_count = processed_count + %s WHERE id = %s",
                    (delta, job_id),
                )
                conn.commit()

    def set_analysis_totals(self, job_id: str, total: int, processed: int) -> None:
        """Set the matched-transcript total and reset processed to the resume point."""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE analysis_jobs SET total_transcripts = %s, processed_count = %s WHERE id = %s",
                    (total, processed, job_id),
                )
                conn.commit()

    def analysis_job_status(self, job_id: str) -> str | None:
        """Current status — the worker polls this to honor a mid-run cancel."""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT status FROM analysis_jobs WHERE id = %s", (job_id,))
                row = cur.fetchone()
                return row[0] if row else None

    def get_analysis_findings(self, job_id: str) -> list[dict]:
        """All map outputs for the reduce/aggregate step, joined to meeting meta."""
        sql = """
            SELECT f.findings, f.error, m.recording_owner, m.meeting_name, m.meeting_datetime
            FROM analysis_findings f
            JOIN meetings m ON m.id = f.meeting_id
            WHERE f.job_id = %s
            ORDER BY m.meeting_datetime ASC NULLS LAST
        """
        with self._connect() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, (job_id,))
                return [dict(r) for r in cur.fetchall()]

    def finish_analysis_job(
        self, job_id: str, status: str, result: dict | None = None, error: str | None = None
    ) -> None:
        """Terminal write: complete / error / canceled, with result or error."""
        sql = """
            UPDATE analysis_jobs SET
                status      = %(status)s,
                result      = COALESCE(%(result)s, result),
                error       = %(error)s,
                finished_at = NOW()
            WHERE id = %(id)s
        """
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, {
                    "id": job_id,
                    "status": status,
                    "result": psycopg2.extras.Json(result) if result is not None else None,
                    "error": error,
                })
                conn.commit()
