import json
import logging
import os
import re

from google import genai
from google.genai import types

from config import Config

logger = logging.getLogger(__name__)

PROMPT_DIR = os.path.join(os.path.dirname(__file__), "prompts")

USER_PROMPT = (
    "Analyze the following meeting transcript and return the JSON object as specified.\n\n"
    "TRANSCRIPT:\n{transcript}"
)


def _load_prompt(meeting_type: str) -> str:
    path = os.path.join(PROMPT_DIR, f"{meeting_type}.txt")
    if not os.path.exists(path):
        logger.warning(f"No prompt file for meeting_type '{meeting_type}', falling back to nurture")
        path = os.path.join(PROMPT_DIR, "nurture.txt")
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _escape_control_chars(text: str) -> str:
    """
    Escape literal control characters inside JSON string values.
    Gemini sometimes emits real newlines/tabs inside strings instead of \\n/\\t,
    which makes json.loads fail with 'Invalid control character'.
    Walks the text character by character, tracking string context.
    """
    result = []
    in_string = False
    escaped = False
    escape_map = {'\n': '\\n', '\r': '\\r', '\t': '\\t'}

    for ch in text:
        if escaped:
            result.append(ch)
            escaped = False
        elif ch == '\\' and in_string:
            result.append(ch)
            escaped = True
        elif ch == '"':
            result.append(ch)
            in_string = not in_string
        elif in_string and ord(ch) < 32:
            result.append(escape_map.get(ch, f'\\u{ord(ch):04x}'))
        else:
            result.append(ch)

    return ''.join(result)


def _extract_json(text: str) -> dict:
    """
    Extract and parse the JSON object from Gemini's response.
    Handles markdown fences and literal control characters in string values.
    """
    # Strip markdown fences if present
    cleaned = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned.strip())

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Escape any literal control characters inside string values and retry
        cleaned = _escape_control_chars(cleaned)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError as e:
            match = re.search(r"\{.*\}", cleaned, re.DOTALL)
            if match:
                return json.loads(match.group())
            raise ValueError(f"Could not parse JSON from Gemini response: {e}\n\nRaw:\n{text[:500]}")


class GeminiClient:
    def __init__(self, config: Config):
        self._api_key = config.gemini_api_key
        self._model_name = config.gemini_model

    def synthesize(self, transcript: str, meeting_type: str) -> dict:
        """
        Call Gemini with the appropriate prompt for this meeting type.
        Returns the parsed JSON output dict.
        """
        system_prompt = _load_prompt(meeting_type)
        user_content = USER_PROMPT.format(transcript=transcript)

        client = genai.Client(api_key=self._api_key)

        logger.info(f"Calling Gemini ({self._model_name}) for meeting_type={meeting_type}")
        response = client.models.generate_content(
            model=self._model_name,
            contents=user_content,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                response_mime_type="application/json",
            ),
        )
        raw = response.text

        result = _extract_json(raw)
        logger.info(f"Gemini returned {len(result)} field(s): {list(result.keys())}")
        return result
