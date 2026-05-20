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

        sql = """
            INSERT INTO meetings (
                pairing_key, meeting_name, meeting_datetime,
                transcript_copy_id, recording_file_id, recording_owner,
                hubspot_deal_id,
                meeting_type, meeting_type_source,
                synthesis_output, rep_talk_pct, prospect_talk_pct,
                transcript_text,
                status, processed_at, synthesized_at
            ) VALUES (
                %(pairing_key)s, %(meeting_name)s, %(meeting_datetime)s,
                %(transcript_copy_id)s, %(recording_file_id)s, %(recording_owner)s,
                %(hubspot_deal_id)s,
                %(meeting_type)s, %(meeting_type_source)s,
                %(synthesis_output)s, %(rep_talk_pct)s, %(prospect_talk_pct)s,
                %(transcript_text)s,
                'complete', %(processed_at)s, %(synthesized_at)s
            )
            ON CONFLICT (pairing_key) DO UPDATE SET
                meeting_type        = EXCLUDED.meeting_type,
                meeting_type_source = EXCLUDED.meeting_type_source,
                synthesis_output    = EXCLUDED.synthesis_output,
                rep_talk_pct        = EXCLUDED.rep_talk_pct,
                prospect_talk_pct   = EXCLUDED.prospect_talk_pct,
                transcript_text     = EXCLUDED.transcript_text,
                hubspot_deal_id     = COALESCE(EXCLUDED.hubspot_deal_id, meetings.hubspot_deal_id),
                status              = 'complete',
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
            "processed_at":       row.get("processed_at") or now,
            "synthesized_at":     now,
        }

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                meeting_id = str(cur.fetchone()[0])
                conn.commit()

        logger.info(f"Upserted meeting {meeting_id} ({row['pairing_key']})")
        return meeting_id

    def upsert_contacts(self, meeting_id: str, contacts: list[dict]) -> None:
        """
        Insert or update meeting_contacts rows for all resolved external participants.
        """
        if not contacts:
            return

        sql = """
            INSERT INTO meeting_contacts (meeting_id, email, hubspot_contact_id)
            VALUES %(values)s
            ON CONFLICT (meeting_id, email) DO UPDATE SET
                hubspot_contact_id = COALESCE(EXCLUDED.hubspot_contact_id, meeting_contacts.hubspot_contact_id)
        """

        values = tuple(
            (meeting_id, c["email"], c.get("hubspot_contact_id"))
            for c in contacts
        )

        with self._connect() as conn:
            with conn.cursor() as cur:
                psycopg2.extras.execute_values(cur, sql, values)
                conn.commit()

        logger.info(f"Upserted {len(contacts)} contact(s) for meeting {meeting_id}")
