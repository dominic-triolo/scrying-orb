"""
Recall.ai calendar auto-join.

Reps connect their Google Calendar to Recall from the orb. Recall then webhooks the
web app whenever a connected calendar changes; the web app only records that a sync
is owed (recall_calendars.sync_from). This module is the worker side: for each owed
calendar it lists the changed events and, per event, schedules or removes the
notetaker bot.

Recording rule: a one-off Google Meet event with at least one attendee outside
@trovatrip.com, that the calendar owner hasn't declined. Recurring series are never
recorded — the "external attendee" test alone also matches internal standups and
all-hands that include someone's personal address, and booked sales calls are one-off.

The bot is scheduled with the metadata recall_queue reads once the call is
transcribed — meeting_name, recording_owner, external_attendees — which is the only
way those reach synthesis, since Google Meet exposes neither to the bot.
"""
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from config import Config
from db import DBClient
from recall import AUTOMATIC_LEAVE, BOT_NAME, RECORDING_CONFIG, RecallClient

logger = logging.getLogger(__name__)

POLL_SECONDS = 30
# The bot enters this long before the scheduled start, so it's already settled in
# when people arrive instead of popping in over the opening hellos.
JOIN_EARLY = timedelta(minutes=1)
INTERNAL_DOMAIN = "trovatrip.com"
# Recall caps each bot metadata value at 500 characters.
_METADATA_MAX = 500
# Calendar "attendees" that aren't people.
_NON_PERSON_SUFFIXES = ("@resource.calendar.google.com", "@group.calendar.google.com")


def _is_internal(email: str) -> bool:
    return email.lower().endswith("@" + INTERNAL_DOMAIN)


def _join_emails(emails: list[str]) -> str:
    """Comma-join, dropping whole trailing emails rather than cutting one in half."""
    out = ""
    for email in emails:
        candidate = f"{out}, {email}" if out else email
        if len(candidate) > _METADATA_MAX:
            break
        out = candidate
    return out


def recording_plan(event: dict, calendar_email: str) -> dict | None:
    """Decide whether `event` gets a bot. Returns the bot metadata if so, else None.
    Pure function over Recall's calendar-event object (Google `raw` payload)."""
    raw = event.get("raw") or {}
    if event.get("is_deleted") or raw.get("status") == "cancelled":
        return None
    # outOfOffice / focusTime / workingLocation blocks are never calls.
    if raw.get("eventType", "default") != "default":
        return None
    # Any instance of a recurring series (see module docstring).
    if raw.get("recurringEventId") or raw.get("recurrence"):
        return None
    if "meet.google.com" not in (event.get("meeting_url") or ""):
        return None

    external: list[str] = []
    for attendee in raw.get("attendees") or []:
        email = (attendee.get("email") or "").strip().lower()
        if attendee.get("self") and attendee.get("responseStatus") == "declined":
            return None
        if not email or attendee.get("resource") or email.endswith(_NON_PERSON_SUFFIXES):
            continue
        if not _is_internal(email):
            external.append(email)
    if not external:
        return None

    # The call belongs to whoever at TrovaTrip set it up — the rep whose booking
    # link or invite it is — not to whichever connected calendar we happened to
    # find it on. A manager invited to a rep's call would otherwise end up owning
    # it. Reading it off the event also means every connected calendar that
    # schedules this (shared) bot names the same owner. Only when the organizer is
    # outside TrovaTrip (the prospect sent the invite) do we fall back to the
    # calendar we found it on.
    organizer = ((raw.get("organizer") or {}).get("email") or "").strip().lower()
    owner = organizer if _is_internal(organizer) else calendar_email.lower()

    return {
        "meeting_name":       (raw.get("summary") or "Untitled meeting")[:_METADATA_MAX],
        "recording_owner":    owner,
        "external_attendees": _join_emails(external),
    }


def sync_calendar(calendar: dict, recall: RecallClient) -> dict:
    """Apply recording_plan to every event changed since the calendar's watermark.
    Returns counts for the log line. Raises on Recall errors so the sync stays owed."""
    now = datetime.now(timezone.utc)
    sync_from = calendar["sync_from"]
    events = recall.list_calendar_events(
        calendar["recall_calendar_id"],
        updated_at_gte=sync_from.isoformat() if sync_from else None,
    )
    # Soonest first, so a rate limit or crash costs the far-future events, not today's.
    events.sort(key=lambda e: e.get("start_time") or "")

    counts = {"scheduled": 0, "removed": 0, "skipped": 0}
    for event in events:
        end = _parse_ts(event.get("end_time"))
        if end and end <= now:
            counts["skipped"] += 1      # Recall rejects scheduling for ended events
            continue

        metadata = recording_plan(event, calendar["email"])
        if metadata:
            recall.schedule_event_bot(
                event["id"],
                # One bot per meeting across every connected calendar.
                deduplication_key=f"{event.get('start_time')}-{event.get('meeting_url')}",
                bot_config=_bot_config(metadata, _parse_ts(event.get("start_time")), now),
            )
            counts["scheduled"] += 1
        elif event.get("bots") and not event.get("is_deleted"):
            # No longer qualifies (externals removed, declined, Meet link dropped).
            # Deleted events are unscheduled by Recall itself.
            recall.unschedule_event_bot(event["id"])
            counts["removed"] += 1
        else:
            counts["skipped"] += 1
    return counts


def _bot_config(metadata: dict, start: datetime | None, now: datetime) -> dict:
    config = {
        "bot_name": BOT_NAME,
        "recording_config": RECORDING_CONFIG,
        "automatic_leave": AUTOMATIC_LEAVE,
        "metadata": metadata,
    }
    # Left unset, Recall joins at the event's start time. Only override while the
    # early time is still ahead of us — a meeting about to begin keeps the default.
    if start and start - JOIN_EARLY > now:
        config["join_at"] = (start - JOIN_EARLY).isoformat()
    return config


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def run_calendar_sync_loop(config: Config, poll_seconds: int = POLL_SECONDS) -> None:
    db = DBClient(config)
    recall = RecallClient(config.recall_api_key, config.recall_region)
    logger.info(f"Calendar sync polling every {poll_seconds}s")
    while True:
        try:
            for calendar in db.get_calendars_needing_sync():
                try:
                    counts = sync_calendar(calendar, recall)
                    db.clear_calendar_sync(str(calendar["id"]), calendar["sync_requested_at"])
                    logger.info(f"Calendar sync {calendar['email']}: {counts}")
                except Exception as err:
                    # Left owed — retried next tick.
                    logger.error(f"Calendar sync failed for {calendar['email']}: {err}",
                                 exc_info=True)
        except Exception as loop_err:
            logger.error(f"Calendar sync loop error: {loop_err}", exc_info=True)
        time.sleep(poll_seconds)


def start_calendar_sync_worker(config: Config) -> threading.Thread:
    """Spawn the calendar-sync poller as a daemon thread alongside the synthesis loop."""
    t = threading.Thread(
        target=run_calendar_sync_loop, args=(config,), daemon=True, name="calendar-sync"
    )
    t.start()
    return t
