"""
Recall.ai meeting-bot client + transcript flattening.

Phase 1 of replacing the Google-Drive transcript scheme (see the design sketch).
Recall sends a bot into a Google Meet, records + transcribes it, and hands us
the transcript via the API. This module is the thin seam between Recall's data
and the rest of synthesis:

  - RecallClient       — create a bot, read a bot, fetch its transcript segments
  - flatten_transcript — Recall's diarized JSON  →  the exact plain-text shape
                         the existing pipeline already understands:
                             "Speaker Name: what they said"
                         one line per utterance. `utils.compute_talk_ratio`
                         parses that format and identifies the rep by first name,
                         so matching it is what keeps the whole downstream
                         (talk ratio + Gemini prompts) unchanged.

Async transcript schema (GET bot → recording.media_shortcuts.transcript.data
.download_url → a JSON array of segments), per docs.recall.ai/docs/download-schemas:

    [
      {
        "participant": {"id": 1, "name": "Rachel Gillette", "email": "...",
                         "is_host": true, "platform": null, "extra_data": null},
        "language_code": "en-US",
        "words": [
          {"text": "Hey",
           "start_timestamp": {"absolute": null, "relative": 0.0},
           "end_timestamp":   {"absolute": null, "relative": 0.4}},
          ...
        ]
      },
      ...
    ]
"""
from __future__ import annotations

import logging
import re

import requests

logger = logging.getLogger("recall")

_TIMEOUT = 30


BOT_NAME = "TrovaTrip Notetaker"

# Recall's built-in transcription provider ($0.15/recording-hour).
# `recallai_async` is only valid on the post-meeting create_transcript endpoint;
# at bot creation the same model is `recallai_streaming` in prioritize_accuracy
# mode, and the transcript lands on the recording.
RECORDING_CONFIG = {"transcript": {"provider": {
    "recallai_streaming": {"mode": "prioritize_accuracy", "language_code": "auto"}}}}

# Recall's default is to leave 2 seconds after the last person does, which ends the
# recording for good if the only human left drops and reconnects. Wait a minute.
AUTOMATIC_LEAVE = {"everyone_left_timeout": {"timeout": 60}}


class RecallClient:
    """Minimal Recall.ai REST client. Region-scoped base URL, e.g.
    https://us-west-2.recall.ai/api/v1 (set RECALL_REGION to match your account)."""

    def __init__(self, api_key: str, region: str = "us-west-2"):
        if not api_key:
            raise ValueError("RecallClient requires an API key (RECALL_API_KEY)")
        self.base = f"https://{region}.recall.ai/api/v1"
        self.base_v2 = f"https://{region}.recall.ai/api/v2"   # calendar endpoints
        self._headers = {
            "Authorization": f"Token {api_key}",
            "Content-Type": "application/json",
        }

    # ── bots ────────────────────────────────────────────────────────────────
    def create_bot(self, meeting_url: str, bot_name: str = BOT_NAME,
                   transcribe: bool = True, metadata: dict | None = None) -> dict:
        """Send a bot into a live meeting. Returns the bot object (grab `id`).
        Used for the Phase-1 spike; in production bots are auto-deployed by the
        Recall calendar integration instead. `metadata` (string values) rides
        on the bot and is how recall_queue learns the meeting name, rep and
        external attendees — Google Meet itself exposes none of them."""
        payload: dict = {"meeting_url": meeting_url, "bot_name": bot_name,
                         "automatic_leave": AUTOMATIC_LEAVE}
        if metadata:
            payload["metadata"] = metadata
        if transcribe:
            payload["recording_config"] = RECORDING_CONFIG
        resp = requests.post(f"{self.base}/bot", headers=self._headers,
                             json=payload, timeout=_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def get_bot(self, bot_id: str) -> dict:
        resp = requests.get(f"{self.base}/bot/{bot_id}", headers=self._headers,
                            timeout=_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    # ── transcript ────────────────────────────────────────────────────────────
    @staticmethod
    def transcript_download_url(bot: dict) -> str | None:
        """Dig the transcript's presigned download URL out of a bot object.
        Returns None until the recording has finished processing (i.e. before the
        `transcript.done` webhook)."""
        for rec in (bot.get("recordings") or []):
            shortcut = ((rec.get("media_shortcuts") or {}).get("transcript") or {})
            url = (shortcut.get("data") or {}).get("download_url")
            if url:
                return url
        return None

    @staticmethod
    def video_download_url(bot: dict) -> str | None:
        """Presigned URL of the bot's mixed video (mp4), or None if it recorded none."""
        for rec in (bot.get("recordings") or []):
            shortcut = ((rec.get("media_shortcuts") or {}).get("video_mixed") or {})
            url = (shortcut.get("data") or {}).get("download_url")
            if url:
                return url
        return None

    def delete_bot_media(self, bot_id: str) -> None:
        """Permanently delete everything Recall stores for a bot (video, audio,
        transcript). Irreversible — only call once our own copies are verified."""
        resp = requests.post(f"{self.base}/bot/{bot_id}/delete_media/",
                             headers=self._headers, timeout=_TIMEOUT)
        resp.raise_for_status()

    def fetch_transcript_segments(self, bot_id: str) -> list:
        """Resolve the download URL for a finished bot and return the parsed
        segment array. Raises if the transcript isn't ready yet."""
        bot = self.get_bot(bot_id)
        url = self.transcript_download_url(bot)
        if not url:
            raise RuntimeError(
                f"bot {bot_id} has no transcript download_url yet "
                f"(status: {_latest_status(bot)}) — wait for the transcript.done webhook"
            )
        # The download URL is a presigned blob link — no auth header.
        resp = requests.get(url, timeout=_TIMEOUT)
        resp.raise_for_status()
        return resp.json()


    # ── calendar v2 ───────────────────────────────────────────────────────────
    def list_calendar_events(self, calendar_id: str, updated_at_gte: str | None = None,
                             start_time_gte: str | None = None) -> list:
        """All events on a connected calendar matching the filters (follows
        pagination). Recall only holds events from 1 day back to 28 days ahead."""
        params = {"calendar_id": calendar_id}
        if updated_at_gte:
            params["updated_at__gte"] = updated_at_gte
        if start_time_gte:
            params["start_time__gte"] = start_time_gte
        events: list = []
        url, query = f"{self.base_v2}/calendar-events/", params
        while url:
            resp = requests.get(url, headers=self._headers, params=query, timeout=_TIMEOUT)
            resp.raise_for_status()
            page = resp.json()
            events.extend(page.get("results") or [])
            # `next` already carries the query string — don't re-send params.
            url, query = page.get("next"), None
        return events

    def schedule_event_bot(self, event_id: str, deduplication_key: str, bot_config: dict) -> dict:
        """Schedule (or replace) the bot for a calendar event. bot_config is not
        merged — send the complete config every time."""
        resp = requests.post(f"{self.base_v2}/calendar-events/{event_id}/bot/",
                             headers=self._headers, timeout=_TIMEOUT,
                             json={"deduplication_key": deduplication_key,
                                   "bot_config": bot_config})
        resp.raise_for_status()
        return resp.json()

    def unschedule_event_bot(self, event_id: str) -> None:
        resp = requests.delete(f"{self.base_v2}/calendar-events/{event_id}/bot/",
                               headers=self._headers, timeout=_TIMEOUT)
        resp.raise_for_status()


def _latest_status(bot: dict) -> str:
    changes = bot.get("status_changes") or []
    return changes[-1].get("code", "unknown") if changes else "unknown"


# ── diarized JSON → "Speaker: text" plain text ───────────────────────────────
_SPACE_BEFORE_PUNCT = re.compile(r"\s+([,.!?;:])")


def _speaker_label(participant: dict) -> str:
    """A display label for a segment's speaker. Prefers the Meet display name;
    falls back to a Title-Cased email local part so the line still matches
    compute_talk_ratio's `^[A-Z][A-Za-z\\s\\-']+:` speaker pattern. Last resort is
    a numbered speaker (won't match the rep, but keeps the utterance readable)."""
    name = (participant.get("name") or "").strip()
    if name:
        return name
    email = (participant.get("email") or "").strip()
    if email:
        return email.split("@")[0].replace(".", " ").replace("_", " ").title()
    return f"Speaker {participant.get('id', '?')}"


# ── overlap smoothing ────────────────────────────────────────────────────────
# Recall diarizes each participant's audio stream separately and interleaves by
# time, so when two people talk at once a sentence comes back cut at word
# boundaries: "We" / "I" / "can't" / "see." / "just. On Google anymore."
# A turn is folded back onto the same speaker's previous one when the other
# person's interruption was only a few words, the speaker hadn't finished their
# sentence, and they carried straight on. Words are reordered, never dropped.
_INTERJECTION_MAX_WORDS = 3
_RESUME_MAX_GAP_SECONDS = 1.0
_SENTENCE_END = re.compile(r"[.?!][\"')\]]*$")


def _word_time(word: dict, edge: str) -> float | None:
    return (word.get(edge) or {}).get("relative")


def _turns(segments: list) -> list[dict]:
    """Non-empty segments as {speaker, text, words, start, end}."""
    turns = []
    for seg in segments or []:
        words = [w for w in (seg.get("words") or []) if (w.get("text") or "").strip()]
        if not words:
            continue        # e.g. the bot itself, which never speaks
        text = " ".join(w["text"].strip() for w in words)
        turns.append({
            "speaker": _speaker_label(seg.get("participant") or {}),
            "text":    _SPACE_BEFORE_PUNCT.sub(r"\1", text),
            "words":   len(words),
            "start":   _word_time(words[0], "start_timestamp"),
            "end":     _word_time(words[-1], "end_timestamp"),
        })
    return turns


def _extend(turn: dict, more: dict) -> None:
    turn["text"] = f"{turn['text']} {more['text']}"
    turn["words"] += more["words"]
    turn["end"] = more["end"]


def _resumes(earlier: dict, interjection: dict, turn: dict) -> bool:
    """Is `turn` the rest of `earlier`'s sentence, split only by `interjection`?"""
    if earlier["speaker"] != turn["speaker"] or interjection["words"] > _INTERJECTION_MAX_WORDS:
        return False
    if _SENTENCE_END.search(earlier["text"]):
        return False
    if earlier["end"] is None or turn["start"] is None:
        return False        # no timing ⇒ can't tell a resume from a new thought
    return turn["start"] - earlier["end"] <= _RESUME_MAX_GAP_SECONDS


def _smooth(turns: list[dict]) -> list[dict]:
    out: list[dict] = []
    for turn in turns:
        if out and out[-1]["speaker"] == turn["speaker"]:
            _extend(out[-1], turn)
        elif len(out) >= 2 and _resumes(out[-2], out[-1], turn):
            # Rejoin the sentence; the interjection now follows it.
            _extend(out[-2], turn)
        else:
            out.append(dict(turn))
    return out


def flatten_transcript(segments: list, smooth: bool = True) -> str:
    """Recall segment array → "Speaker Name: utterance" lines, the format the rest
    of synthesis already expects. Empty segments (e.g. the bot itself, which never
    speaks) are dropped. With `smooth`, sentences that overlapping speech cut into
    fragments are rejoined (see above); pass False for one line per raw segment."""
    turns = _turns(segments)
    if smooth:
        turns = _smooth(turns)
    return "\n".join(f"{t['speaker']}: {t['text']}" for t in turns)
