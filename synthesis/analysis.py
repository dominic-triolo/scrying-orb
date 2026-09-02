"""
Cross-transcript analysis worker.

Runs as a background thread inside the synthesis service (start_analysis_worker),
polling analysis_jobs for status='queued' more often than the 5-minute synthesis
loop so a submitted analysis starts promptly.

Per job it runs a plan -> map -> aggregate -> reduce pipeline:
  plan      one Gemini call turns the free-text question into a small, consistent
            field schema (enum/boolean/string) to extract from every transcript.
  map       per transcript (bounded concurrency), Gemini fills those fields +
            a summary + supporting quotes; written to analysis_findings.
  aggregate exact counts per field are computed in PYTHON (LLMs count poorly).
  reduce    one Gemini call writes the narrative answer over the exact stats +
            a bounded sample of findings.

The user can cancel mid-run (web flips status to 'canceled'); the worker checks
between map batches and stops. Findings are keyed (job_id, meeting_id), so a
crash/restart resumes rather than re-charging Gemini for done transcripts.
"""

import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from config import Config
from db import DBClient
from gemini import GeminiClient

logger = logging.getLogger(__name__)

MAP_CONCURRENCY = 5          # simultaneous Gemini map calls
MAP_BATCH = MAP_CONCURRENCY * 4   # cancel is checked between batches this size
POLL_SECONDS = 8             # analysis-queue poll cadence
REDUCE_SAMPLE = 80           # max per-transcript findings fed to the reduce step

_PROMPT_DIR = os.path.join(os.path.dirname(__file__), "prompts")


def _prompt(name: str) -> str:
    with open(os.path.join(_PROMPT_DIR, name), "r", encoding="utf-8") as f:
        return f.read()


def _chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def _plan(gemini: GeminiClient, query: str) -> dict:
    """Derive a small, consistent extraction schema from the question."""
    try:
        out = gemini.generate_json(_prompt("analysis_plan.txt"), f"QUESTION:\n{query}")
        fields = out.get("fields")
        if isinstance(fields, list):
            return {"fields": fields[:5]}
    except Exception as e:
        logger.warning(f"analysis plan step failed, proceeding schema-less: {e}")
    return {"fields": []}


def _map_user(query: str, schema: dict, m: dict) -> str:
    return (
        f"QUESTION:\n{query}\n\n"
        f"FIELDS TO EXTRACT (schema):\n{json.dumps(schema.get('fields', []))}\n\n"
        f"CALL: {m.get('meeting_name')} | rep: {m.get('recording_owner')} "
        f"| date: {m.get('meeting_datetime')}\n\n"
        f"TRANSCRIPT:\n{m.get('transcript_text') or ''}"
    )


def _map_one(gemini: GeminiClient, db: DBClient, job_id: str, query: str,
             schema: dict, m: dict) -> None:
    meeting_id = str(m["id"])
    try:
        findings = gemini.generate_json(_prompt("analysis_map.txt"), _map_user(query, schema, m))
        db.save_analysis_finding(job_id, meeting_id, findings)
    except Exception as e:
        logger.warning(f"map failed for meeting {meeting_id}: {e}")
        db.save_analysis_finding(job_id, meeting_id, {}, error=str(e)[:500])
    finally:
        db.bump_analysis_progress(job_id)


def _aggregate(schema: dict, findings: list[dict]) -> dict:
    """Exact per-field value counts over the relevant, error-free findings."""
    fields = schema.get("fields", [])
    by_field: dict[str, dict[str, int]] = {}
    total_relevant = 0
    for f in findings:
        if f.get("error"):
            continue
        data = f.get("findings") or {}
        if data.get("relevant") is False:
            continue
        total_relevant += 1
        fvals = data.get("fields") or {}
        for field in fields:
            name = field.get("name")
            if name in fvals and fvals[name] is not None:
                val = str(fvals[name])
                by_field.setdefault(name, {})
                by_field[name][val] = by_field[name].get(val, 0) + 1
    return {"by_field": by_field, "total_relevant": total_relevant}


def _reduce(gemini: GeminiClient, query: str, schema: dict, stats: dict,
            findings: list[dict]) -> dict:
    samples = []
    for f in findings:
        if f.get("error"):
            continue
        d = f.get("findings") or {}
        samples.append({
            "rep": f.get("recording_owner"),
            "summary": d.get("summary"),
            "fields": d.get("fields"),
            "quotes": (d.get("quotes") or [])[:2],
        })
        if len(samples) >= REDUCE_SAMPLE:
            break
    user = (
        f"QUESTION:\n{query}\n\n"
        f"AGGREGATE STATS (exact counts — ground truth):\n"
        f"{json.dumps(stats['by_field'], indent=2)}\n"
        f"Transcripts analyzed: {len(findings)}; relevant to the question: {stats['total_relevant']}\n\n"
        f"SAMPLE PER-TRANSCRIPT FINDINGS (subset of {len(samples)}):\n"
        f"{json.dumps(samples, indent=2, default=str)}"
    )
    try:
        return gemini.generate_json(_prompt("analysis_reduce.txt"), user)
    except Exception as e:
        logger.error(f"reduce step failed: {e}")
        return {
            "answer": "The per-transcript analysis completed, but the summary step failed. "
                      "The aggregate stats below are still exact.",
            "key_findings": [],
            "caveats": [f"Summary generation error: {e}"],
        }


def process_job(job: dict, gemini: GeminiClient, db: DBClient) -> None:
    job_id = str(job["id"])
    query = job["query"]
    filters = job.get("filters") or {}

    schema = _plan(gemini, query)
    logger.info(f"[{job_id}] schema fields: {[f.get('name') for f in schema.get('fields', [])]}")

    meetings = db.fetch_analysis_meetings(filters)
    done = db.analysis_done_meeting_ids(job_id)
    db.set_analysis_totals(job_id, total=len(meetings), processed=len(done))
    logger.info(f"[{job_id}] {len(meetings)} transcripts matched ({len(done)} already done)")

    if not meetings:
        db.finish_analysis_job(job_id, "complete", result={
            "answer": "No transcripts matched the selected filters.",
            "key_findings": [], "caveats": [],
            "stats": {"by_field": {}, "total_relevant": 0},
            "field_schema": schema, "total_analyzed": 0, "total_relevant": 0, "errors": 0,
        })
        return

    todo = [m for m in meetings if str(m["id"]) not in done]

    canceled = False
    with ThreadPoolExecutor(max_workers=MAP_CONCURRENCY) as ex:
        for batch in _chunks(todo, MAP_BATCH):
            if db.analysis_job_status(job_id) == "canceled":
                canceled = True
                break
            futures = [ex.submit(_map_one, gemini, db, job_id, query, schema, m) for m in batch]
            for fut in as_completed(futures):
                fut.result()  # _map_one swallows its own errors; this just surfaces bugs

    if canceled:
        logger.info(f"[{job_id}] canceled mid-run")
        db.finish_analysis_job(job_id, "canceled")
        return

    findings = db.get_analysis_findings(job_id)
    stats = _aggregate(schema, findings)
    narrative = _reduce(gemini, query, schema, stats, findings)

    result = {
        **narrative,
        "stats": stats,
        "field_schema": schema,
        "total_analyzed": len(findings),
        "total_relevant": stats["total_relevant"],
        "errors": sum(1 for f in findings if f.get("error")),
    }
    db.finish_analysis_job(job_id, "complete", result=result)
    logger.info(f"[{job_id}] complete — {len(findings)} analyzed, {stats['total_relevant']} relevant")


def run_analysis_loop(config: Config, poll_seconds: int = POLL_SECONDS) -> None:
    gemini = GeminiClient(config)
    db = DBClient(config)
    logger.info(f"Analysis worker polling every {poll_seconds}s")
    while True:
        try:
            job = db.claim_next_analysis_job()
            if job:
                logger.info(f"Analysis job {job['id']} claimed: {str(job['query'])[:80]!r}")
                try:
                    process_job(job, gemini, db)
                except Exception as e:
                    logger.error(f"Analysis job {job['id']} failed: {e}", exc_info=True)
                    db.finish_analysis_job(str(job["id"]), "error", error=str(e)[:1000])
                continue  # drain the queue before sleeping
        except Exception as loop_err:
            logger.error(f"Analysis loop error: {loop_err}", exc_info=True)
        time.sleep(poll_seconds)


def start_analysis_worker(config: Config) -> threading.Thread:
    """Spawn the analysis poller as a daemon thread alongside the synthesis loop."""
    t = threading.Thread(
        target=run_analysis_loop, args=(config,), daemon=True, name="analysis-worker"
    )
    t.start()
    return t
