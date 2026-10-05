"""
Copy notetaker recordings from Recall.ai into our own bucket.

Once a Recall bot's meeting has been synthesized, this thread streams its video
(and the raw word-level transcript JSON, which the flattened text in Postgres
doesn't preserve) from Recall's presigned URLs into our S3-compatible bucket and
points meetings.recording_key at the video. The meeting page then plays it from
the bucket through a signed link.

Recall is not asked to delete anything unless MEDIA_DELETE_FROM_RECALL=1, and then
only after both uploads have been verified by size — deletion there is permanent.

Inert until MEDIA_S3_BUCKET is set.
"""
import logging
import threading
import time

import boto3
import requests

from config import Config
from db import DBClient
from recall import RecallClient

logger = logging.getLogger(__name__)

POLL_SECONDS = 60
MAX_ATTEMPTS = 5
_DOWNLOAD_TIMEOUT = (10, 300)   # connect, read — videos are large


def video_key(bot_id: str) -> str:
    return f"recordings/{bot_id}.mp4"


def transcript_key(bot_id: str) -> str:
    return f"transcripts/{bot_id}.json"


class MediaStore:
    """Thin wrapper over an S3-compatible bucket (R2, S3, Railway)."""

    def __init__(self, config: Config):
        self.bucket = config.media_s3_bucket
        self._s3 = boto3.client(
            "s3",
            endpoint_url=config.media_s3_endpoint or None,
            region_name=config.media_s3_region,
            aws_access_key_id=config.media_s3_access_key_id,
            aws_secret_access_key=config.media_s3_secret_access_key,
        )

    def copy_from_url(self, url: str, key: str, content_type: str) -> int:
        """Stream `url` into the bucket without touching disk, then confirm the
        stored object is the size the source said it was. Returns the byte count."""
        with requests.get(url, stream=True, timeout=_DOWNLOAD_TIMEOUT) as resp:
            resp.raise_for_status()
            expected = int(resp.headers.get("Content-Length") or 0)
            self._s3.upload_fileobj(resp.raw, self.bucket, key,
                                    ExtraArgs={"ContentType": content_type})
        stored = self._s3.head_object(Bucket=self.bucket, Key=key)["ContentLength"]
        if stored == 0 or (expected and stored != expected):
            raise RuntimeError(f"{key}: stored {stored} bytes, source was {expected}")
        return stored


def copy_bot_media(bot_id: str, recall: RecallClient, store: MediaStore,
                   db: DBClient, delete_from_recall: bool) -> str:
    """Copy one bot's media. Returns the media_status to record."""
    bot = recall.get_bot(bot_id)
    video_url = recall.video_download_url(bot)
    if not video_url:
        return "none"

    size = store.copy_from_url(video_url, video_key(bot_id), "video/mp4")
    transcript_url = recall.transcript_download_url(bot)
    if transcript_url:
        store.copy_from_url(transcript_url, transcript_key(bot_id), "application/json")

    if not db.set_meeting_recording_key(f"recall:{bot_id}", video_key(bot_id)):
        raise RuntimeError(f"no meeting row for recall:{bot_id}")
    logger.info(f"Copied recording for bot {bot_id} ({size / 1_048_576:.1f} MB)")

    if delete_from_recall:
        recall.delete_bot_media(bot_id)
        logger.info(f"Deleted Recall media for bot {bot_id}")
    return "copied"


def run_media_copy_loop(config: Config, poll_seconds: int = POLL_SECONDS) -> None:
    db = DBClient(config)
    recall = RecallClient(config.recall_api_key, config.recall_region)
    store = MediaStore(config)
    logger.info(f"Media copy polling every {poll_seconds}s → bucket {store.bucket} "
                f"(delete from Recall: {config.media_delete_from_recall})")
    while True:
        try:
            for pending in db.get_recall_media_pending(MAX_ATTEMPTS):
                pending_id, bot_id = str(pending["id"]), pending["bot_id"]
                try:
                    status = copy_bot_media(bot_id, recall, store, db,
                                            config.media_delete_from_recall)
                    db.set_recall_media_status(pending_id, status)
                except Exception as err:
                    logger.error(f"Media copy failed for bot {bot_id}: {err}", exc_info=True)
                    db.set_recall_media_status(pending_id, "error", str(err))
        except Exception as loop_err:
            logger.error(f"Media copy loop error: {loop_err}", exc_info=True)
        time.sleep(poll_seconds)


def start_media_copy_worker(config: Config) -> threading.Thread:
    """Spawn the media-copy poller as a daemon thread alongside the synthesis loop."""
    t = threading.Thread(
        target=run_media_copy_loop, args=(config,), daemon=True, name="media-copy"
    )
    t.start()
    return t
