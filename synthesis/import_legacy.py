"""
Import legacy attention.io meetings into the orb (one-off backfill).

Reads the per-rep CSV exports (one row per meeting, transcript inline) and inserts
them as status='legacy', import_source='attention' meetings. Legacy meetings are
shown to reps but NOT synthesized until requested (web "Analyze" button) — the
synthesis worker never touches them (it only polls status='pending_synthesis' /
the handoff Sheet).

No Drive or HubSpot API access needed: the transcript and the HubSpot contact/deal
ids are already in the CSV. Recording linking (recording_file_id) is a separate
pass once the Drive uploads finish.

Idempotent: keyed on pairing_key = conversation_id. Re-running updates the imported
fields but never clobbers a meeting a rep has already analyzed (status /
synthesis_output / meeting_type are left untouched on conflict).

Usage:
    DATABASE_URL=postgres://... python import_legacy.py PATH [PATH ...] [--dry-run] [--limit N]

PATH may be a CSV file or a directory (all *.csv within are imported).
"""
from __future__ import annotations

import argparse
import csv
import glob
import logging
import os
import re
import sys
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

from utils import detect_meeting_type

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("import_legacy")

# csv fields can be very large (full transcripts) — lift the default 128KB limit.
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))


INSERT_MEETING = """
    INSERT INTO meetings (
        pairing_key, meeting_name, meeting_datetime, recording_owner,
        hubspot_deal_id, meeting_type, meeting_type_source, transcript_text,
        recording_file_id, status, import_source, processed_at
    ) VALUES (
        %(pairing_key)s, %(meeting_name)s, %(meeting_datetime)s, %(recording_owner)s,
        %(hubspot_deal_id)s, %(meeting_type)s, %(meeting_type_source)s, %(transcript_text)s,
        %(recording_file_id)s, 'legacy', 'attention', %(processed_at)s
    )
    ON CONFLICT (pairing_key) DO UPDATE SET
        meeting_name      = EXCLUDED.meeting_name,
        meeting_datetime  = EXCLUDED.meeting_datetime,
        recording_owner   = EXCLUDED.recording_owner,
        hubspot_deal_id   = COALESCE(EXCLUDED.hubspot_deal_id, meetings.hubspot_deal_id),
        transcript_text   = EXCLUDED.transcript_text,
        -- link recordings on a later re-import once the Drive uploads land; never
        -- null out a link we already have if a later export omits it.
        recording_file_id = COALESCE(EXCLUDED.recording_file_id, meetings.recording_file_id),
        import_source     = EXCLUDED.import_source
        -- deliberately NOT touching status / synthesis_output / synthesized_at /
        -- meeting_type: a re-run must never wipe an analysis a rep already ran.
    RETURNING id
"""

UPSERT_CONTACT = """
    INSERT INTO meeting_contacts (meeting_id, email, hubspot_contact_id, deals)
    VALUES (%(meeting_id)s, %(email)s, %(hubspot_contact_id)s, '[]'::jsonb)
    ON CONFLICT (meeting_id, email) DO UPDATE SET
        hubspot_contact_id = COALESCE(EXCLUDED.hubspot_contact_id,
                                      meeting_contacts.hubspot_contact_id)
"""


def _split(value: str) -> list[str]:
    """Split a comma/semicolon-separated cell into trimmed, non-empty parts."""
    if not value:
        return []
    return [p.strip() for p in value.replace(";", ",").split(",") if p.strip()]


def _parse_dt(value: str):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


_DRIVE_ID = re.compile(r"/d/([A-Za-z0-9_-]+)|[?&]id=([A-Za-z0-9_-]+)")


def _drive_file_id(link: str) -> str | None:
    """Pull the Drive file id out of a share link. Handles the common shapes:
      https://drive.google.com/file/d/<id>/view
      https://drive.google.com/open?id=<id>
    A bare id (no URL) is used as-is. Returns None if nothing usable is found."""
    link = (link or "").strip()
    if not link:
        return None
    m = _DRIVE_ID.search(link)
    if m:
        return m.group(1) or m.group(2)
    # bare id (no slashes / scheme)
    if "/" not in link and re.fullmatch(r"[A-Za-z0-9_-]+", link):
        return link
    return None


def _pair_contacts(emails: list[str], contact_ids: list[str]) -> list[tuple]:
    """Pair emails with hubspot contact ids positionally, but only when the counts
    line up 1:1 — otherwise we can't trust the pairing, so keep the emails and drop
    the ids (email alone still identifies the contact)."""
    if len(emails) == len(contact_ids):
        return list(zip(emails, contact_ids))
    return [(e, None) for e in emails]


def import_row(cur, row: dict) -> str | None:
    conv_id = (row.get("conversation_id") or "").strip()
    if not conv_id:
        return None

    title = (row.get("title") or "").strip() or "(untitled)"
    meeting_type, source = detect_meeting_type(title)  # keyword match; usually nurture/default

    cur.execute(INSERT_MEETING, {
        "pairing_key":        conv_id,
        "meeting_name":       title,
        "meeting_datetime":   _parse_dt(row.get("created_at", "")),
        "recording_owner":    (row.get("owner_email") or "").strip() or None,
        "hubspot_deal_id":    next(iter(_split(row.get("hubspot_deal_ids", ""))), None),
        "meeting_type":       meeting_type,
        "meeting_type_source": source,
        "transcript_text":    (row.get("transcript") or "").strip() or None,
        "recording_file_id":  _drive_file_id(row.get("recording_drive_link", "")),
        "processed_at":       datetime.now(timezone.utc),
    })
    meeting_id = cur.fetchone()[0]

    for email, contact_id in _pair_contacts(
        _split(row.get("attendee_emails", "")),
        _split(row.get("hubspot_contact_ids", "")),
    ):
        cur.execute(UPSERT_CONTACT, {
            "meeting_id": meeting_id, "email": email, "hubspot_contact_id": contact_id,
        })
    return str(meeting_id)


def iter_csv_paths(paths: list[str]):
    for p in paths:
        if os.path.isdir(p):
            yield from sorted(glob.glob(os.path.join(p, "*.csv")))
        else:
            yield p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="+", help="CSV file(s) or directory(ies)")
    ap.add_argument("--dry-run", action="store_true", help="parse + count, write nothing")
    ap.add_argument("--limit", type=int, default=None, help="max rows per file (testing)")
    args = ap.parse_args()

    conn = None
    if not args.dry_run:
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            ap.error("DATABASE_URL not set")
        conn = psycopg2.connect(dsn)

    total = 0
    try:
        for path in iter_csv_paths(args.paths):
            imported = errors = 0
            with open(path, newline="", encoding="utf-8") as f:
                cur = conn.cursor() if conn else None
                try:
                    for i, row in enumerate(csv.DictReader(f)):
                        if args.limit is not None and i >= args.limit:
                            break
                        try:
                            if args.dry_run:
                                imported += 1 if (row.get("conversation_id") or "").strip() else 0
                                continue
                            if import_row(cur, row):
                                imported += 1
                        except Exception as e:  # keep going; one bad row shouldn't stop a file
                            errors += 1
                            logger.warning("row %d in %s failed: %s", i, os.path.basename(path), e)
                            conn.rollback()
                finally:
                    if cur:
                        cur.close()
            if conn:
                conn.commit()
            total += imported
            logger.info("%s: %d imported, %d errors%s",
                        os.path.basename(path), imported, errors,
                        " (dry-run)" if args.dry_run else "")
    finally:
        if conn:
            conn.close()
    logger.info("DONE — %d meeting(s) %s", total, "counted" if args.dry_run else "imported")


if __name__ == "__main__":
    main()
