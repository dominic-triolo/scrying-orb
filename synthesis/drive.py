import logging

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from config import Config

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]


class DriveClient:
    def __init__(self, config: Config):
        creds = service_account.Credentials.from_service_account_info(
            config.google_service_account_info, scopes=SCOPES
        )
        self._service = build("drive", "v3", credentials=creds)

    def read_transcript(self, file_id: str) -> str:
        """
        Export a Google Doc transcript to plain text and return its contents.
        Raises RuntimeError if the file cannot be read.
        """
        try:
            content = (
                self._service.files()
                .export(fileId=file_id, mimeType="text/plain")
                .execute()
            )
            # export() returns bytes
            if isinstance(content, bytes):
                content = content.decode("utf-8")
            logger.info(f"Read transcript {file_id} ({len(content):,} chars)")
            return content
        except HttpError as e:
            raise RuntimeError(f"Failed to read transcript {file_id}: {e}") from e
