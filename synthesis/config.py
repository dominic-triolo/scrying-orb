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

    # Nurture tool ingest (meeting.processed emit) — all optional; unset ⇒ emit is skipped
    nurture_ingest_url: str = ""
    nurture_ingest_secret: str = ""
    nurture_web_url: str = ""       # base URL of the scrying-orb web app, for the deep link

    # Recall.ai meeting-bot ingest (replacing the Drive transcript scheme) — all
    # optional; unset ⇒ the Recall path is inert and the legacy Drive path is used.
    recall_api_key: str = ""
    recall_region: str = "us-west-2"
    recall_webhook_secret: str = ""

    # Our Cloudflare R2 bucket for notetaker recordings. All optional; unset
    # bucket ⇒ media stays on Recall and nothing is copied.
    media_r2_bucket: str = ""
    media_r2_endpoint: str = ""          # https://<account-id>.r2.cloudflarestorage.com
    media_r2_access_key_id: str = ""
    media_r2_secret_access_key: str = ""
    # Delete a bot's media from Recall once our copy is verified. Off by default —
    # deletion is permanent, so turn it on only after playback from the bucket is proven.
    media_delete_from_recall: bool = False

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
            nurture_ingest_url=os.environ.get("NURTURE_INGEST_URL", ""),
            nurture_ingest_secret=os.environ.get("NURTURE_INGEST_SECRET", ""),
            nurture_web_url=os.environ.get("SCRYING_ORB_WEB_URL", ""),
            recall_api_key=os.environ.get("RECALL_API_KEY", ""),
            recall_region=os.environ.get("RECALL_REGION", "us-west-2"),
            recall_webhook_secret=os.environ.get("RECALL_WEBHOOK_SECRET", ""),
            media_r2_bucket=os.environ.get("MEDIA_R2_BUCKET", ""),
            media_r2_endpoint=os.environ.get("MEDIA_R2_ENDPOINT", ""),
            media_r2_access_key_id=os.environ.get("MEDIA_R2_ACCESS_KEY_ID", ""),
            media_r2_secret_access_key=os.environ.get("MEDIA_R2_SECRET_ACCESS_KEY", ""),
            media_delete_from_recall=os.environ.get("MEDIA_DELETE_FROM_RECALL", "") == "1",
        )
