import json
import os
from dataclasses import dataclass, field


@dataclass
class Config:
    # Google
    google_service_account_info: dict
    log_sheet_id: str
    log_sheet_tab: str

    # Gemini
    gemini_api_key: str
    gemini_model: str

    # Database
    database_url: str

    # HubSpot
    hubspot_token: str

    # Poller
    poll_interval_seconds: int

    @classmethod
    def from_env(cls) -> "Config":
        sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
        if not sa_json:
            raise ValueError("GOOGLE_SERVICE_ACCOUNT_JSON is not set")

        return cls(
            google_service_account_info=json.loads(sa_json),
            log_sheet_id=os.environ["LOG_SHEET_ID"],
            log_sheet_tab=os.environ.get("LOG_SHEET_TAB", "Meetings"),
            gemini_api_key=os.environ["GEMINI_API_KEY"],
            gemini_model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
            database_url=os.environ["DATABASE_URL"],
            hubspot_token=os.environ.get("HUBSPOT_TOKEN", ""),
            poll_interval_seconds=int(os.environ.get("POLL_INTERVAL_SECONDS", "300")),
        )
