"""
Emit `meeting.processed` — and `calendar.event` — to the new-business nurture tool.

Fires when a meeting reaches a terminal processed state so the nurture tool can pick up
intro calls (→ awaiting-stepper) and later calls (→ block exit outcomes). Best-effort and
NON-FATAL: if the nurture ingest is unconfigured or unreachable, synthesis completion is
never blocked. Bearer + HMAC auth; contract in the nurture repo docs/nurture/03.
"""
import hashlib
import hmac
import json
import logging
import time
import uuid
from datetime import datetime, timezone

import requests

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def emit_meeting_processed(config, *, source_meeting_id, pairing_key, meeting_name,
                           meeting_type, meeting_type_source, meeting_datetime, outcome,
                           status, recording_owner, synthesis, contacts, hubspot_deal_id,
                           synthesized) -> None:
    """POST a meeting.processed event to the nurture ingest. Never raises."""
    url = getattr(config, "nurture_ingest_url", "") or ""
    secret = getattr(config, "nurture_ingest_secret", "") or ""
    if not url or not secret:
        return                                  # nurture ingest not configured — skip

    now = _now_iso()
    web = getattr(config, "nurture_web_url", "") or ""
    deep_link = f"{web.rstrip('/')}/meetings/{source_meeting_id}" if web else None
    event_id = str(uuid.uuid4())
    payload = {
        "event_id": event_id,
        "event_type": "meeting.processed",
        "emitted_at": now,
        "meeting": {
            "source_meeting_id": str(source_meeting_id),
            "pairing_key": pairing_key,
            "meeting_name": meeting_name,
            "meeting_type": meeting_type,
            "meeting_type_source": meeting_type_source,
            "meeting_datetime": meeting_datetime,
            "outcome": outcome,
            "recording_owner": recording_owner,
            "status": status,
            "processed_at": now,
            "synthesized_at": now if synthesized else None,
            "deep_link": deep_link,
        },
        "synthesis_output": synthesis or None,
        "contacts": [
            {"email": c.get("email"), "hubspot_contact_id": c.get("hubspot_contact_id"),
             "deals": c.get("deals", [])}
            for c in (contacts or [])
        ],
        "hubspot_deal_id": hubspot_deal_id,
    }

    raw = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    headers = {
        "Authorization": f"Bearer {secret}",
        "X-Signature": sig,
        "X-Event-Id": event_id,
        "Content-Type": "application/json",
    }
    endpoint = f"{url.rstrip('/')}/api/nurture/ingest/meeting"

    for attempt in range(1, 4):
        try:
            resp = requests.post(endpoint, data=raw, headers=headers, timeout=10)
            if resp.status_code < 300:
                logger.info("nurture emit ok (%s) for %s", resp.status_code, pairing_key)
                return
            logger.warning("nurture emit %s for %s: %s", resp.status_code, pairing_key,
                           resp.text[:200])
        except Exception as e:
            logger.warning("nurture emit attempt %s failed for %s: %s", attempt, pairing_key, e)
        time.sleep(2 * attempt)
    logger.error("nurture emit failed after retries for %s", pairing_key)


# ── calendar.event: a rep's meeting with someone outside was created / moved / cancelled ──

INTERNAL_DOMAIN = "trovatrip.com"
_NON_PERSON_SUFFIXES = ("@resource.calendar.google.com", "@group.calendar.google.com")


def calendar_event_payload(event: dict, calendar_email: str) -> dict | None:
    """What the nurture tool needs to know about one calendar event, or None if the event
    is not worth telling it about. Pure function over Recall's calendar-event object.

    Wider than the recording rule on purpose: the nurture tool wants to hear that a call
    moved or was cancelled whether or not it had a Meet link, so those don't gate it here,
    and neither does the event being cancelled. Still skipped: non-meeting blocks, recurring
    series (booked prospect calls are one-off, and a weekly all-hands with someone's personal
    address would otherwise be sent every week), and anything with no outside attendee.

    Deliberately minimal: who, when, and whether it is still on. No title, no description.
    """
    raw = event.get("raw") or {}
    if raw.get("eventType", "default") != "default":
        return None
    if raw.get("recurringEventId") or raw.get("recurrence"):
        return None
    external = []
    for attendee in raw.get("attendees") or []:
        email = (attendee.get("email") or "").strip().lower()
        if not email or attendee.get("resource") or email.endswith(_NON_PERSON_SUFFIXES):
            continue
        if not email.endswith("@" + INTERNAL_DOMAIN):
            external.append(email)
    start = event.get("start_time") or ((raw.get("start") or {}).get("dateTime"))
    if not external or not start:
        return None
    organizer = ((raw.get("organizer") or {}).get("email") or "").strip().lower()
    owner = organizer if organizer.endswith("@" + INTERNAL_DOMAIN) else calendar_email.lower()
    cancelled = bool(event.get("is_deleted")) or raw.get("status") == "cancelled"
    return {
        # The same meeting has a different Recall id on each connected calendar; Google's
        # iCalUID is the one id they share.
        "id": raw.get("iCalUID") or str(event.get("id") or ""),
        "status": "cancelled" if cancelled else "confirmed",
        "start_time": start,
        "owner": owner,
        "attendees": external,
    }


def emit_calendar_event(config, event: dict, calendar_email: str) -> bool:
    """POST a calendar.event to the nurture ingest. Never raises; returns whether anything
    was sent. The event id is derived from what the event says, so a re-sync that finds the
    same state sends the same id and the nurture tool drops it as a duplicate."""
    url = getattr(config, "nurture_ingest_url", "") or ""
    secret = getattr(config, "nurture_ingest_secret", "") or ""
    if not url or not secret:
        return False
    try:
        body = calendar_event_payload(event, calendar_email)
        if body is None:
            return False
        state = f"{body['id']}|{body['status']}|{body['start_time']}"
        event_id = "cal-" + hashlib.sha256(state.encode()).hexdigest()[:32]
        payload = {"event_id": event_id, "event_type": "calendar.event",
                   "emitted_at": _now_iso(), "event": body}
        raw = json.dumps(payload).encode()
        headers = {
            "Authorization": f"Bearer {secret}",
            "X-Signature": "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest(),
            "X-Event-Id": event_id,
            "Content-Type": "application/json",
        }
        endpoint = f"{url.rstrip('/')}/api/nurture/ingest/calendar"
        # One short retry only: this runs inside the calendar sync loop, once per changed
        # event, and must not hold it up. A lost event is not fatal — the nurture tool
        # catches a call with no record after its date and flags it.
        for attempt in (1, 2):
            try:
                resp = requests.post(endpoint, data=raw, headers=headers, timeout=5)
                if resp.status_code < 300:
                    return True
                logger.warning("nurture calendar emit %s: %s", resp.status_code, resp.text[:200])
                if resp.status_code < 500:
                    return False
            except Exception as e:
                logger.warning("nurture calendar emit attempt %s failed: %s", attempt, e)
            time.sleep(0.5)
        return False
    except Exception as e:
        logger.warning("nurture calendar emit error (non-fatal): %s", e)
        return False
