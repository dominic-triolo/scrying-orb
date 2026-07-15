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
from nurture_emit import emit_meeting_processed
from drive import DriveClient
from forecast import ForecastClient
from gemini import GeminiClient
from hubspot import HubSpotClient
from sheet import SheetClient
from datetime import datetime
from utils import compute_talk_ratio, detect_meeting_type

SILENT_FORECAST_PROPERTY = "silent_forecast_probability"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def _emit(config, meeting_id, row, meeting_type, meeting_type_source, outcome, status,
          synthesis, contacts, hubspot_deal_id, synthesized):
    """Best-effort nurture emit — never let it break synthesis completion."""
    try:
        emit_meeting_processed(
            config,
            source_meeting_id=meeting_id,
            pairing_key=row.get("pairing_key"),
            meeting_name=row.get("meeting_name"),
            meeting_type=meeting_type,
            meeting_type_source=meeting_type_source,
            meeting_datetime=row.get("meeting_datetime"),
            outcome=outcome,
            status=status,
            recording_owner=row.get("recording_owner"),
            synthesis=synthesis,
            contacts=contacts,
            hubspot_deal_id=hubspot_deal_id,
            synthesized=synthesized,
        )
    except Exception as e:
        logger.warning(f"nurture emit hook error (non-fatal): {e}")


def process_row(
    row: dict,
    sheet: SheetClient,
    drive: DriveClient,
    gemini: GeminiClient,
    forecaster: ForecastClient,
    hubspot: HubSpotClient,
    db: DBClient,
    config: Config = None,
) -> None:
    pairing_key = row["pairing_key"]
    logger.info(f"Processing: {pairing_key}")

    try:
        # 1. Resolve external participant emails in HubSpot (moved early so we can
        #    use contact IDs for meeting type lookup before synthesis)
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

        # 2. Determine meeting type + outcome: try HubSpot first, fall back to keyword detection
        meeting_type, meeting_type_source = detect_meeting_type(row["meeting_name"])
        meeting_outcome: str | None = None

        raw_dt = row.get("meeting_datetime", "")
        if raw_dt:
            try:
                meeting_date = datetime.fromisoformat(raw_dt.replace("Z", "+00:00"))
                for contact in contacts:
                    cid = contact.get("hubspot_contact_id")
                    if not cid:
                        continue
                    hs_info = hubspot.find_meeting_info(cid, row["meeting_name"], meeting_date)
                    # Capture outcome regardless of whether type is resolved
                    if hs_info.get("outcome"):
                        meeting_outcome = hs_info["outcome"]
                    if hs_info.get("activity_type"):
                        type_id = db.get_meeting_type_id_by_label(hs_info["activity_type"])
                        if type_id:
                            meeting_type = type_id
                            meeting_type_source = "hubspot"
                    # Stop at first contact that yields a HubSpot match
                    if hs_info.get("activity_type") or hs_info.get("outcome"):
                        break
            except (ValueError, AttributeError) as exc:
                logger.warning(f"HubSpot meeting info lookup skipped: {exc}")

        logger.info(f"Meeting type: {meeting_type} ({meeting_type_source}), outcome: {meeting_outcome}")

        # 3. Gate synthesis on meeting outcome
        # If HubSpot reports a known outcome that isn't COMPLETED, skip synthesis
        # and store the meeting record with status reflecting the outcome.
        if meeting_outcome and meeting_outcome.upper() != "COMPLETED":
            logger.info(
                f"Skipping synthesis for {pairing_key}: outcome={meeting_outcome}"
            )
            transcript = drive.read_transcript(row["transcript_copy_id"])
            talk_ratio = compute_talk_ratio(transcript, row.get("recording_owner", ""))
            meeting_id = db.upsert_meeting(
                row=row,
                meeting_type=meeting_type,
                meeting_type_source=meeting_type_source,
                synthesis={},
                talk_ratio=talk_ratio,
                hubspot_deal_id=hubspot_deal_id,
                transcript_text=transcript,
                meeting_outcome=meeting_outcome,
                skip_synthesis=True,
            )
            db.upsert_contacts(meeting_id, contacts)
            sheet.mark_complete(row["row_index"])
            _emit(config, meeting_id, row, meeting_type, meeting_type_source,
                  meeting_outcome, "no_show", {}, contacts, hubspot_deal_id, synthesized=False)
            logger.info(f"Stored {meeting_outcome} meeting without synthesis: {pairing_key}")
            return

        # 4. Read transcript from Shared Meetings Drive folder
        transcript = drive.read_transcript(row["transcript_copy_id"])

        # 5. Compute talk ratio (pure string parsing — no API call)
        talk_ratio = compute_talk_ratio(transcript, row.get("recording_owner", ""))

        # 6. Run Gemini synthesis
        synthesis = gemini.synthesize(transcript, meeting_type)

        # 7. Write to Postgres
        meeting_id = db.upsert_meeting(
            row=row,
            meeting_type=meeting_type,
            meeting_type_source=meeting_type_source,
            synthesis=synthesis,
            talk_ratio=talk_ratio,
            hubspot_deal_id=hubspot_deal_id,
            transcript_text=transcript,
            meeting_outcome=meeting_outcome,
        )
        db.upsert_contacts(meeting_id, contacts)

        # 8. Silent forecast — intro calls only, best-effort (never blocks completion)
        if meeting_type == "intro" and hubspot_deal_id:
            try:
                prob = forecaster.predict(synthesis)
                if prob is not None:
                    hubspot.update_deal_property(
                        hubspot_deal_id, SILENT_FORECAST_PROPERTY, str(prob)
                    )
            except Exception as forecast_err:
                logger.warning(f"Silent forecast failed (non-fatal): {forecast_err}")

        # 9. Mark sheet row complete
        sheet.mark_complete(row["row_index"])
        _emit(config, meeting_id, row, meeting_type, meeting_type_source,
              meeting_outcome, "complete", synthesis, contacts, hubspot_deal_id,
              synthesized=True)
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

    sheet      = SheetClient(config)
    drive      = DriveClient(config)
    gemini     = GeminiClient(config)
    forecaster = ForecastClient(config)
    hubspot    = HubSpotClient(config)
    db         = DBClient(config)

    logger.info(f"Polling every {config.poll_interval_seconds}s")

    while True:
        try:
            # 1. New meetings from the Google Sheet
            pending = sheet.get_pending_rows()
            for row in pending:
                process_row(row, sheet, drive, gemini, forecaster, hubspot, db, config)

            # 2. Meetings queued for re-synthesis due to manual type change
            for meeting in db.get_pending_resynthesis():
                resynthesize_meeting(meeting, gemini, db)

        except Exception as poll_err:
            logger.error(f"Poller error: {poll_err}", exc_info=True)

        time.sleep(config.poll_interval_seconds)


if __name__ == "__main__":
    run()
