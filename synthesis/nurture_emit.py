"""
Emit `meeting.processed` to the new-business nurture tool.

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
