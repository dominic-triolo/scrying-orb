import logging
from datetime import datetime

from google.oauth2 import service_account
from googleapiclient.discovery import build

from config import Config

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

# Column indices (0-based) matching the handoff sheet schema:
# processed_at | meeting_name | meeting_datetime | pairing_key |
# transcript_copy_id | recording_file_id | recording_owner |
# external_attendees | status | notes
COL = {
    "processed_at":      0,
    "meeting_name":      1,
    "meeting_datetime":  2,
    "pairing_key":       3,
    "transcript_copy_id": 4,
    "recording_file_id": 5,
    "recording_owner":   6,
    "external_attendees": 7,
    "status":            8,
    "notes":             9,
}


class SheetClient:
    def __init__(self, config: Config):
        self._service_account_info = config.google_service_account_info
        self._sheet_id = config.log_sheet_id
        self._tab = config.log_sheet_tab
        self._service = self._build_service()

    def _build_service(self):
        creds = service_account.Credentials.from_service_account_info(
            self._service_account_info, scopes=SCOPES
        )
        return build("sheets", "v4", credentials=creds)

    def _range(self, row: int | None = None) -> str:
        if row is None:
            return f"{self._tab}"
        return f"{self._tab}!A{row}:J{row}"

    def get_pending_rows(self) -> list[dict]:
        """Return all rows with status = 'pending_synthesis'."""
        for attempt in range(2):
            try:
                result = (
                    self._service.spreadsheets()
                    .values()
                    .get(spreadsheetId=self._sheet_id, range=self._tab)
                    .execute()
                )
                break
            except BrokenPipeError:
                if attempt == 0:
                    logger.warning("Broken pipe on Sheets API — rebuilding client and retrying")
                    self._service = self._build_service()
                else:
                    raise
        rows = result.get("values", [])
        if not rows:
            return []

        pending = []
        for i, row in enumerate(rows[1:], start=2):  # skip header; row 2 = index 2
            # Pad short rows to avoid index errors
            row = row + [""] * (10 - len(row))
            if row[COL["status"]] != "pending_synthesis":
                continue
            if not row[COL["transcript_copy_id"]]:
                logger.warning(f"Row {i} is pending but has no transcript_copy_id — skipping")
                continue
            pending.append({
                "row_index":          i,
                "processed_at":       row[COL["processed_at"]],
                "meeting_name":       row[COL["meeting_name"]],
                "meeting_datetime":   row[COL["meeting_datetime"]],
                "pairing_key":        row[COL["pairing_key"]],
                "transcript_copy_id": row[COL["transcript_copy_id"]],
                "recording_file_id":  row[COL["recording_file_id"]],
                "recording_owner":    row[COL["recording_owner"]],
                "external_attendees": row[COL["external_attendees"]],
                "notes":              row[COL["notes"]],
            })

        logger.info(f"Found {len(pending)} pending row(s)")
        return pending

    def mark_complete(self, row_index: int) -> None:
        self._update_status(row_index, "complete", "")

    def mark_error(self, row_index: int, error_msg: str) -> None:
        self._update_status(row_index, "error", error_msg[:500])

    def _update_status(self, row_index: int, status: str, notes: str) -> None:
        range_ = f"{self._tab}!I{row_index}:J{row_index}"
        self._service.spreadsheets().values().update(
            spreadsheetId=self._sheet_id,
            range=range_,
            valueInputOption="RAW",
            body={"values": [[status, notes]]},
        ).execute()
        logger.info(f"Row {row_index} → {status}")
