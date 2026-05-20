import re
import logging

logger = logging.getLogger(__name__)

MEETING_TYPE_KEYWORDS = {
    "intro": "intro",
    "planning": "planning",
    "nurture": "nurture",
}


def detect_meeting_type(meeting_name: str) -> tuple[str, str]:
    """
    Parse meeting type from the calendar event title.

    Expected formats:
      "TrovaTrip Intro Call: Host and Rep"
      "Planning Call: Host and Rep"
      "Nurture Call: Host and Rep"

    Falls back to ('nurture', 'default') if no keyword is found.
    Returns (meeting_type, source) where source is 'parsed' or 'default'.
    """
    name_lower = meeting_name.lower()
    for keyword, meeting_type in MEETING_TYPE_KEYWORDS.items():
        if keyword in name_lower:
            return meeting_type, "parsed"
    return "nurture", "default"


def compute_talk_ratio(transcript: str, rep_email: str) -> dict:
    """
    Parse speaker-labelled lines from the transcript and return talk percentages.

    Gemini Meet transcripts use the format:
        Speaker Name: text of what they said

    The rep is identified by matching their first name (extracted from rep_email)
    against speaker labels. All other speakers are counted as prospect.

    Returns {'rep_talk_pct': float|None, 'prospect_talk_pct': float|None}.
    None values indicate the transcript format couldn't be parsed.
    """
    # Extract rep's first name from email  e.g. rachel.gillette@trovatrip.com → "rachel"
    try:
        rep_first = rep_email.split("@")[0].split(".")[0].lower()
    except Exception:
        rep_first = ""

    # Match lines like "Speaker Name: content..." at the start of a line
    pattern = re.compile(r"^([A-Z][A-Za-z\s\-']+?):\s+(.+)", re.MULTILINE)
    matches = pattern.findall(transcript)

    if not matches:
        logger.warning("Could not parse speaker labels from transcript — talk ratio unavailable")
        return {"rep_talk_pct": None, "prospect_talk_pct": None}

    word_counts: dict[str, int] = {}
    for speaker, text in matches:
        speaker = speaker.strip()
        word_counts[speaker] = word_counts.get(speaker, 0) + len(text.split())

    total = sum(word_counts.values())
    if total == 0:
        return {"rep_talk_pct": None, "prospect_talk_pct": None}

    rep_words = sum(
        count
        for speaker, count in word_counts.items()
        if rep_first and rep_first in speaker.lower()
    )
    prospect_words = total - rep_words

    return {
        "rep_talk_pct": round(rep_words / total * 100, 2),
        "prospect_talk_pct": round(prospect_words / total * 100, 2),
    }
