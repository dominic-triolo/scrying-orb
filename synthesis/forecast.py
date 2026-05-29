"""
ForecastClient — predicts host conversion probability from synthesis output.

Input:  synthesis_output dict (already computed by GeminiClient.synthesize)
Output: float from {0, 0.2, 0.4, 0.6, 0.8, 1.0}

The model is called silently after intro call synthesis. Results are written
to the HubSpot deal property 'silent_forecast_probability' for comparison
against the rep's manual forecast category.
"""

import json
import logging
import os

from google import genai
from google.genai import types

from config import Config

logger = logging.getLogger(__name__)

PROMPT_DIR = os.path.join(os.path.dirname(__file__), "prompts")
VALID_PROBABILITIES = {0.0, 0.2, 0.4, 0.6, 0.8, 1.0}

# Fields from synthesis_output that are most predictive — sent in this order
FORECAST_FIELDS = [
    "summary",
    "eagerness_level",
    "rapport",
    "concerns_objections",
    "motivated_by",
    "positive_moments",
    "next_steps",
    "personal_details",
    "destinations_mentioned",
    "ideal_trip_time",
]


def _load_forecast_prompt() -> str:
    path = os.path.join(PROMPT_DIR, "forecast.txt")
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _build_user_content(synthesis: dict) -> str:
    """
    Render the synthesis output as a clean JSON block for the model.
    Only includes the fields relevant to forecasting, in a consistent order.
    """
    payload = {k: synthesis.get(k, "") for k in FORECAST_FIELDS}
    return "SYNTHESIS OUTPUT:\n" + json.dumps(payload, indent=2, ensure_ascii=False)


def _parse_probability(raw: str) -> float:
    """
    Parse the model's output — expects a bare number like '0.8'.
    Raises ValueError if the output is not a valid probability.
    """
    text = raw.strip().strip('"').strip("'")
    try:
        value = float(text)
    except ValueError:
        raise ValueError(f"Could not parse probability from response: {raw!r}")

    # Round to nearest valid level to handle minor floating point drift
    rounded = min(VALID_PROBABILITIES, key=lambda v: abs(v - value))
    if abs(rounded - value) > 0.05:
        raise ValueError(
            f"Parsed value {value} is not close to any valid probability level "
            f"({sorted(VALID_PROBABILITIES)}). Raw response: {raw!r}"
        )
    return rounded


class ForecastClient:
    def __init__(self, config: Config):
        self._api_key = config.gemini_api_key
        self._model_name = config.gemini_model
        self._system_prompt = _load_forecast_prompt()

    def predict(self, synthesis: dict, max_retries: int = 2) -> float | None:
        """
        Predict host conversion probability from a synthesis output dict.

        Returns a float from {0.0, 0.2, 0.4, 0.6, 0.8, 1.0}, or None if
        prediction fails after retries (caller should log and continue).
        """
        user_content = _build_user_content(synthesis)
        client = genai.Client(api_key=self._api_key)

        last_error: Exception | None = None
        for attempt in range(1, max_retries + 1):
            logger.info(f"Forecast attempt {attempt}/{max_retries}")
            try:
                response = client.models.generate_content(
                    model=self._model_name,
                    contents=user_content,
                    config=types.GenerateContentConfig(
                        system_instruction=self._system_prompt,
                        temperature=0.0,  # deterministic — this is a classification task
                    ),
                )
                prob = _parse_probability(response.text)
                logger.info(f"Forecast probability: {prob}")
                return prob
            except Exception as e:
                last_error = e
                logger.warning(f"Forecast attempt {attempt} failed: {e}")

        logger.error(f"Forecast failed after {max_retries} attempts: {last_error}")
        return None
