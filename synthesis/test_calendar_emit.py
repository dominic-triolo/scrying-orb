"""Checks for the calendar.event emit to the nurture tool. No network, no database:

    python synthesis/test_calendar_emit.py
"""
import json
import sys
import types
from unittest.mock import patch

import nurture_emit as ne

ME = "sam@trovatrip.com"


def _event(**over):
    raw = {
        "iCalUID": "abc123@google.com",
        "status": "confirmed",
        "organizer": {"email": ME},
        "attendees": [{"email": ME, "self": True}, {"email": "Jordan@Example.com"}],
    }
    raw.update(over.pop("raw", {}))
    event = {"id": "recall-1", "start_time": "2026-07-27T17:00:00Z", "is_deleted": False,
             "meeting_url": "https://meet.google.com/x", "raw": raw}
    event.update(over)
    return event


def test_payload():
    p = ne.calendar_event_payload(_event(), ME)
    assert p == {"id": "abc123@google.com", "status": "confirmed",
                 "start_time": "2026-07-27T17:00:00Z", "owner": ME,
                 "attendees": ["jordan@example.com"]}, p
    assert "summary" not in p and "meeting_name" not in p        # no title leaves the orb

    # no Meet link is fine here (unlike the recording rule)
    assert ne.calendar_event_payload(_event(meeting_url=None), ME) is not None
    # cancelled either way round is reported as cancelled, not dropped
    assert ne.calendar_event_payload(_event(is_deleted=True), ME)["status"] == "cancelled"
    assert ne.calendar_event_payload(_event(raw={"status": "cancelled"}), ME)["status"] == "cancelled"
    # not worth sending
    assert ne.calendar_event_payload(_event(raw={"eventType": "outOfOffice"}), ME) is None
    assert ne.calendar_event_payload(_event(raw={"recurringEventId": "r1"}), ME) is None
    assert ne.calendar_event_payload(_event(raw={"attendees": [{"email": ME}]}), ME) is None
    assert ne.calendar_event_payload(
        _event(raw={"attendees": [{"email": "room@resource.calendar.google.com"}]}), ME) is None
    # an outside organizer → the call belongs to the calendar we found it on
    outside = ne.calendar_event_payload(_event(raw={"organizer": {"email": "jordan@example.com"}}),
                                        "kim@trovatrip.com")
    assert outside["owner"] == "kim@trovatrip.com"
    # a colleague's invite → it belongs to the colleague, whichever calendar we read it from
    assert ne.calendar_event_payload(_event(), "manager@trovatrip.com")["owner"] == ME


def test_emit():
    cfg = types.SimpleNamespace(nurture_ingest_url="https://nurture.example/",
                                nurture_ingest_secret="s3cret")
    sent = []

    class Resp:
        status_code, text = 200, "ok"

    def post(url, data=None, headers=None, timeout=None):
        sent.append((url, json.loads(data), headers))
        return Resp()

    with patch.object(ne.requests, "post", side_effect=post):
        assert ne.emit_calendar_event(cfg, _event(), ME) is True
        assert ne.emit_calendar_event(cfg, _event(), ME) is True                 # same state
        assert ne.emit_calendar_event(cfg, _event(start_time="2026-08-03T17:00:00Z"), ME) is True
        assert ne.emit_calendar_event(cfg, _event(raw={"recurringEventId": "r"}), ME) is False
    url, body, headers = sent[0]
    assert url == "https://nurture.example/api/nurture/ingest/calendar"
    assert body["event_type"] == "calendar.event" and body["event"]["attendees"] == ["jordan@example.com"]
    assert headers["Authorization"] == "Bearer s3cret" and headers["X-Signature"].startswith("sha256=")
    assert sent[0][1]["event_id"] == sent[1][1]["event_id"]      # a re-sync dedupes downstream
    assert sent[0][1]["event_id"] != sent[2][1]["event_id"]      # a moved call is a new event
    assert len(sent) == 3

    # unconfigured, or the request blowing up, never raises
    assert ne.emit_calendar_event(types.SimpleNamespace(), _event(), ME) is False
    with patch.object(ne.requests, "post", side_effect=RuntimeError("down")), \
         patch.object(ne.time, "sleep"):
        assert ne.emit_calendar_event(cfg, _event(), ME) is False


if __name__ == "__main__":
    test_payload()
    test_emit()
    print("ok")
    sys.exit(0)
