"""
Recall.ai intake for the synthesis worker.

The Recall webhook (web/app/api/recall/webhook) queues a bot in Postgres when its
transcript is ready. The two classes here present that queue to main.process_row
through the same surface as the legacy Google path, so the pipeline downstream
(HubSpot, Gemini, upsert, nurture emit) runs unchanged:

  RecallQueue            ↔ SheetClient   (get_pending_rows / mark_complete / mark_error)
  RecallTranscriptStore  ↔ DriveClient   (read_transcript)

Google Meet exposes neither the calendar title nor attendee emails to the bot, so
the row's meeting_name / recording_owner / external_attendees come from the bot's
`metadata`, set by whoever created the bot (the spike today, the calendar
integration in Phase 3).
"""
import logging

from db import DBClient
from recall import RecallClient, flatten_transcript

logger = logging.getLogger(__name__)

_KEY_PREFIX = "recall:"
# Other companies' recording bots sit in the call as participants; they don't count
# as someone having shown up.
_BOT_NAME_HINTS = ("notetaker", "note taker", "recorder", "otter", "fireflies",
                   "fathom", "read.ai")


class RecallQueue:
    def __init__(self, db: DBClient, client: RecallClient):
        self._db = db
        self._client = client

    def get_pending_rows(self) -> list[dict]:
        """Queued bots as process_row-shaped dicts. `row_index` is the queue row id."""
        rows = []
        for pending in self._db.get_pending_recall_bots():
            pending_id = str(pending["id"])
            try:
                bot = self._client.get_bot(pending["bot_id"])
                rows.append(_row_from_bot(bot, pending_id, self._client.fetch_participants(bot)))
            except Exception as err:
                logger.error(f"Recall bot {pending['bot_id']} unreadable: {err}")
                self.mark_error(pending_id, str(err))
        if rows:
            logger.info(f"Found {len(rows)} pending Recall bot(s)")
        return rows

    def mark_complete(self, row_index: str) -> None:
        self._db.set_recall_pending_status(row_index, "complete")

    def mark_error(self, row_index: str, error_msg: str) -> None:
        self._db.set_recall_pending_status(row_index, "error", error_msg[:500])


class RecallTranscriptStore:
    def __init__(self, client: RecallClient):
        self._client = client

    def read_transcript(self, transcript_key: str) -> str:
        """`recall:<bot_id>` → "Speaker Name: text" lines. Empty when nobody spoke
        (a no-show); process_row refuses to synthesize an empty transcript."""
        bot_id = transcript_key.removeprefix(_KEY_PREFIX)
        transcript = flatten_transcript(self._client.fetch_transcript_segments(bot_id))
        logger.info(f"Read Recall transcript {bot_id} ({len(transcript):,} chars)")
        return transcript


def people_who_joined(participants: list) -> int:
    """Distinct humans among the participants the bot saw. Counted by Meet's stable
    per-person id — not by display name, which two different people can share."""
    people = set()
    for participant in participants:
        name = (participant.get("name") or "").strip().lower()
        if any(hint in name for hint in _BOT_NAME_HINTS):
            continue
        meet = ((participant.get("extra_data") or {}).get("google_meet") or {})
        people.add(meet.get("static_participant_id") or f"#{participant.get('id')}")
    return len(people)


def _row_from_bot(bot: dict, pending_id: str, participants: list | None = None) -> dict:
    bot_id = bot["id"]
    metadata = bot.get("metadata") or {}
    recording = (bot.get("recordings") or [{}])[0]

    meeting_name = metadata.get("meeting_name") or ""
    if not meeting_name:
        meeting_url = bot.get("meeting_url") or {}
        meeting_name = f"Google Meet {meeting_url.get('meeting_id') or bot_id}"
        logger.warning(f"Recall bot {bot_id} has no meeting_name metadata — using '{meeting_name}'")
    if not metadata.get("recording_owner"):
        logger.warning(f"Recall bot {bot_id} has no recording_owner metadata — rep unattributed")

    return {
        "row_index":          pending_id,
        "processed_at":       "",
        "meeting_name":       meeting_name,
        "meeting_datetime":   recording.get("started_at") or bot.get("join_at") or "",
        "pairing_key":        f"{_KEY_PREFIX}{bot_id}",
        "transcript_copy_id": f"{_KEY_PREFIX}{bot_id}",
        "recording_file_id":  "",   # Drive-only; Recall media is Phase 4
        "recording_owner":    metadata.get("recording_owner") or "",
        "external_attendees": metadata.get("external_attendees") or "",
        "notes":              "",
        # Only one person ever in the call ⇒ the other side never came. Synthesis
        # runs minutes after the call, before a rep has logged an outcome in
        # HubSpot, so without this a rep waiting alone is synthesized as a real call.
        # An unknown participant list is never read as a no-show.
        "inferred_no_show":   participants is not None and people_who_joined(participants) <= 1,
    }
