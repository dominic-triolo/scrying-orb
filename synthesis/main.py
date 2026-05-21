"""
TrovaTrip Synthesis Service
----------------------------
Polls the handoff Google Sheet for pending_synthesis rows, runs Gemini AI
analysis on each transcript, resolves HubSpot contacts, writes to Postgres,
and marks the sheet row complete.

Entry point for the Railway worker process.
"""

import logging
import time

from config import Config
from db import DBClient
from drive import DriveClient
from gemini import GeminiClient
from hubspot import HubSpotClient
from sheet import SheetClient
from utils import compute_talk_ratio, detect_meeting_type

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def process_row(
    row: dict,
    sheet: SheetClient,
    drive: DriveClient,
    gemini: GeminiClient,
    hubspot: HubSpotClient,
    db: DBClient,
) -> None:
    pairing_key = row["pairing_key"]
    logger.info(f"Processing: {pairing_key}")

    try:
        # 1. Detect meeting type from calendar event title
        meeting_type, meeting_type_source = detect_meeting_type(row["meeting_name"])
        logger.info(f"Meeting type: {meeting_type} ({meeting_type_source})")

        # 2. Read transcript from Shared Meetings Drive folder
        transcript = drive.read_transcript(row["transcript_copy_id"])

        # 3. Compute talk ratio (pure string parsing — no API call)
        talk_ratio = compute_talk_ratio(transcript, row.get("recording_owner", ""))

        # 4. Run Gemini synthesis
        synthesis = gemini.synthesize(transcript, meeting_type)

        # 5. Resolve external participant emails in HubSpot
        emails = [
            e.strip()
            for e in row.get("external_attendees", "").split(",")
            if e.strip()
        ]
        contacts = hubspot.resolve_contacts(emails)

        # Use the deal ID from the first resolved contact (most likely the primary prospect)
        hubspot_deal_id = next(
            (c["hubspot_deal_id"] for c in contacts if c.get("hubspot_deal_id")),
            None,
        )

        # 6. Write to Postgres
        meeting_id = db.upsert_meeting(
            row=row,
            meeting_type=meeting_type,
            meeting_type_source=meeting_type_source,
            synthesis=synthesis,
            talk_ratio=talk_ratio,
            hubspot_deal_id=hubspot_deal_id,
            transcript_text=transcript,
        )
        db.upsert_contacts(meeting_id, contacts)

        # 7. Mark sheet row complete
        sheet.mark_complete(row["row_index"])
        logger.info(f"Complete: {pairing_key}")

    except Exception as err:
        logger.error(f"Error processing {pairing_key}: {err}", exc_info=True)
        sheet.mark_error(row["row_index"], str(err))


def resynthesize_meeting(
    meeting: dict,
    gemini: GeminiClient,
    db: DBClient,
) -> None:
    """
    Re-run Gemini synthesis on a meeting whose type was changed manually.
    Uses the transcript already stored in Postgres — no Sheet or Drive access needed.
    """
    meeting_id   = str(meeting["id"])
    meeting_type = meeting["meeting_type"]
    transcript   = meeting["transcript_text"]
    recording_owner = meeting.get("recording_owner", "")

    logger.info(f"Re-synthesizing meeting {meeting_id} as type={meeting_type}")
    try:
        talk_ratio = compute_talk_ratio(transcript, recording_owner)
        synthesis  = gemini.synthesize(transcript, meeting_type)
        db.complete_resynthesis(meeting_id, synthesis, talk_ratio)
        logger.info(f"Re-synthesis done for {meeting_id}")
    except Exception as err:
        logger.error(f"Re-synthesis error for {meeting_id}: {err}", exc_info=True)


def run() -> None:
    logger.info("Synthesis service starting up")
    config = Config.from_env()

    sheet   = SheetClient(config)
    drive   = DriveClient(config)
    gemini  = GeminiClient(config)
    hubspot = HubSpotClient(config)
    db      = DBClient(config)

    logger.info(f"Polling every {config.poll_interval_seconds}s")

    while True:
        try:
            # 1. New meetings from the Google Sheet
            pending = sheet.get_pending_rows()
            for row in pending:
                process_row(row, sheet, drive, gemini, hubspot, db)

            # 2. Meetings queued for re-synthesis due to manual type change
            for meeting in db.get_pending_resynthesis():
                resynthesize_meeting(meeting, gemini, db)

        except Exception as poll_err:
            logger.error(f"Poller error: {poll_err}", exc_info=True)

        time.sleep(config.poll_interval_seconds)


if __name__ == "__main__":
    run()
