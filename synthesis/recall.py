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


class RecallClient:
    """Minimal Recall.ai REST client. Region-scoped base URL, e.g.
    https://us-west-2.recall.ai/api/v1 (set RECALL_REGION to match your account)."""

    def __init__(self, api_key: str, region: str = "us-west-2"):
        if not api_key:
            raise ValueError("RecallClient requires an API key (RECALL_API_KEY)")
        self.base = f"https://{region}.recall.ai/api/v1"
        self._headers = {
            "Authorization": f"Token {api_key}",
            "Content-Type": "application/json",
        }

    # ── bots ────────────────────────────────────────────────────────────────
    def create_bot(self, meeting_url: str, bot_name: str = "TrovaTrip Notetaker",
                   transcribe: bool = True) -> dict:
        """Send a bot into a live meeting. Returns the bot object (grab `id`).
        Used for the Phase-1 spike; in production bots are auto-deployed by the
        Recall calendar integration instead."""
        payload: dict = {"meeting_url": meeting_url, "bot_name": bot_name}
        if transcribe:
            # Recall's built-in transcription provider ($0.15/recording-hour).
            payload["recording_config"] = {"transcript": {"provider": {"recallai_async": {}}}}
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


def flatten_transcript(segments: list) -> str:
    """Recall segment array → "Speaker Name: utterance" lines (one per segment),
    the format the rest of synthesis already expects. Empty segments (e.g. the
    bot itself, which never speaks) are dropped."""
    lines: list[str] = []
    for seg in segments or []:
        participant = seg.get("participant") or {}
        words = seg.get("words") or []
        text = " ".join((w.get("text") or "").strip() for w in words).strip()
        text = _SPACE_BEFORE_PUNCT.sub(r"\1", text)
        if not text:
            continue
        lines.append(f"{_speaker_label(participant)}: {text}")
    return "\n".join(lines)
