"""
Phase-1 spike: prove a Recall.ai transcript flattens into the exact shape the
existing synthesis pipeline understands.

Three modes:

  # 1. No network — validate the flatten + talk-ratio parse against a baked-in
  #    Recall-shaped payload. Run this FIRST; it needs no Recall account.
  python -m spike_recall --selftest

  # 2. Send a bot into a live Meet (needs RECALL_API_KEY). Prints the bot id;
  #    start/stop a short test call, then use mode 3 once it's done.
  python -m spike_recall --create "https://meet.google.com/abc-defg-hij"

  # 3. Fetch a finished bot's transcript, flatten it, print raw + flattened,
  #    and run compute_talk_ratio to confirm the rep is identified.
  python -m spike_recall --bot <bot_id> --rep rachel.gillette@trovatrip.com

Env: RECALL_API_KEY, RECALL_REGION (default us-west-2).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from recall import RecallClient, flatten_transcript
from utils import compute_talk_ratio

# A minimal Recall async-transcript payload (two speakers) matching the
# documented schema — used by --selftest so the format is validated offline.
_FIXTURE = [
    {
        "participant": {"id": 1, "name": "Rachel Gillette", "email": "rachel.gillette@trovatrip.com",
                        "is_host": True, "platform": None, "extra_data": None},
        "language_code": "en-US",
        "words": [
            {"text": "Hey", "start_timestamp": {"absolute": None, "relative": 0.0},
             "end_timestamp": {"absolute": None, "relative": 0.3}},
            {"text": "Jordan,", "start_timestamp": {"absolute": None, "relative": 0.3},
             "end_timestamp": {"absolute": None, "relative": 0.7}},
            {"text": "thanks", "start_timestamp": {"absolute": None, "relative": 0.7},
             "end_timestamp": {"absolute": None, "relative": 1.0}},
            {"text": "for", "start_timestamp": {"absolute": None, "relative": 1.0},
             "end_timestamp": {"absolute": None, "relative": 1.1}},
            {"text": "hopping", "start_timestamp": {"absolute": None, "relative": 1.1},
             "end_timestamp": {"absolute": None, "relative": 1.4}},
            {"text": "on", "start_timestamp": {"absolute": None, "relative": 1.4},
             "end_timestamp": {"absolute": None, "relative": 1.5}},
        ],
    },
    {
        "participant": {"id": 2, "name": "Jordan Lee", "email": "jordan@example.com",
                        "is_host": False, "platform": None, "extra_data": None},
        "language_code": "en-US",
        "words": [
            {"text": "Happy", "start_timestamp": {"absolute": None, "relative": 2.0},
             "end_timestamp": {"absolute": None, "relative": 2.3}},
            {"text": "to", "start_timestamp": {"absolute": None, "relative": 2.3},
             "end_timestamp": {"absolute": None, "relative": 2.4}},
            {"text": "be", "start_timestamp": {"absolute": None, "relative": 2.4},
             "end_timestamp": {"absolute": None, "relative": 2.5}},
            {"text": "here.", "start_timestamp": {"absolute": None, "relative": 2.5},
             "end_timestamp": {"absolute": None, "relative": 2.8}},
        ],
    },
    # The bot joins as a participant but never speaks → no words → dropped.
    {"participant": {"id": 3, "name": "TrovaTrip Notetaker", "email": None},
     "language_code": "en-US", "words": []},
]


def _show(segments: list, rep_email: str) -> None:
    flat = flatten_transcript(segments)
    print("── flattened transcript ──────────────────────────────────────")
    print(flat)
    print("── compute_talk_ratio ────────────────────────────────────────")
    print(json.dumps(compute_talk_ratio(flat, rep_email), indent=2))


def main() -> int:
    ap = argparse.ArgumentParser(description="Recall.ai Phase-1 spike")
    ap.add_argument("--selftest", action="store_true",
                    help="validate flatten + talk-ratio offline (no Recall account)")
    ap.add_argument("--create", metavar="MEETING_URL",
                    help="send a bot into a live Google Meet")
    ap.add_argument("--bot", metavar="BOT_ID",
                    help="fetch a finished bot's transcript and flatten it")
    ap.add_argument("--rep", default="rachel.gillette@trovatrip.com",
                    help="rep email, for the talk-ratio check")
    ap.add_argument("--raw", action="store_true",
                    help="also dump the raw Recall segment JSON")
    args = ap.parse_args()

    if args.selftest:
        print("SELFTEST: flattening a baked-in Recall payload (no network)\n")
        if args.raw:
            print(json.dumps(_FIXTURE, indent=2), "\n")
        _show(_FIXTURE, args.rep)
        return 0

    if not (args.create or args.bot):
        ap.error("pass --selftest, --create <meeting_url>, or --bot <bot_id>")

    client = RecallClient(os.environ.get("RECALL_API_KEY", ""),
                          os.environ.get("RECALL_REGION", "us-west-2"))

    if args.create:
        bot = client.create_bot(args.create)
        print(f"Bot dispatched. id = {bot.get('id')}")
        print("Let it join + record a short call, then re-run with "
              f"--bot {bot.get('id')} once the transcript is ready.")
        return 0

    segments = client.fetch_transcript_segments(args.bot)
    if args.raw:
        print(json.dumps(segments, indent=2), "\n")
    _show(segments, args.rep)
    return 0


if __name__ == "__main__":
    sys.exit(main())
