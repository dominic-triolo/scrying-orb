"""
eval_forecast.py — offline evaluation of the forecast model against training data.

Usage:
    python eval_forecast.py --csv "path/to/training.csv"

Steps:
    1. Load transcripts + ground-truth forecast categories from the CSV
    2. Run Gemini synthesis on each transcript (meeting_type=intro), caching results
       in eval_cache.json so re-runs don't cost extra API calls
    3. Run ForecastClient.predict on each synthesis output
    4. Report exact-match accuracy, mean absolute error (MAE), and a confusion matrix
    5. Flag rows where |predicted - actual| >= 0.4 (large misses worth reviewing)

Requires environment variables:
    GEMINI_API_KEY
    GEMINI_MODEL (optional, defaults to gemini-2.0-flash)
    DATABASE_URL (not used here, but Config reads it)
"""

import argparse
import csv
import json
import os
import sys
import time
from collections import defaultdict

# Allow running from the synthesis/ directory directly
sys.path.insert(0, os.path.dirname(__file__))

from config import Config
from gemini import GeminiClient
from forecast import ForecastClient

CACHE_FILE = os.path.join(os.path.dirname(__file__), "eval_cache.json")
VALID_LEVELS = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]


def load_cache() -> dict:
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(cache: dict) -> None:
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def load_training_data(csv_path: str) -> list[dict]:
    rows = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            transcript = row.get("Transcript", "").strip()
            raw_cat = row.get("Forecast category", "").strip()
            if not transcript or raw_cat == "":
                print(f"[SKIP] Row {i+1}: missing transcript or category")
                continue
            try:
                category = float(raw_cat)
            except ValueError:
                print(f"[SKIP] Row {i+1}: invalid category '{raw_cat}'")
                continue
            rows.append({"idx": i + 1, "transcript": transcript, "actual": category})
    return rows


def run_synthesis(row: dict, gemini: GeminiClient, cache: dict) -> dict | None:
    key = f"synthesis_{row['idx']}"
    if key in cache:
        return cache[key]
    print(f"  Synthesizing row {row['idx']}...")
    try:
        result = gemini.synthesize(row["transcript"], meeting_type="intro")
        cache[key] = result
        save_cache(cache)
        time.sleep(0.5)  # gentle rate limiting
        return result
    except Exception as e:
        print(f"  [ERROR] Synthesis failed for row {row['idx']}: {e}")
        return None


def run_forecast(row_idx: int, synthesis: dict, forecaster: ForecastClient, cache: dict) -> float | None:
    key = f"forecast_{row_idx}"
    if key in cache:
        return cache[key]
    result = forecaster.predict(synthesis)
    if result is not None:
        cache[key] = result
        save_cache(cache)
    time.sleep(0.3)
    return result


def print_results(results: list[dict]) -> None:
    actuals    = [r["actual"] for r in results]
    predicted  = [r["predicted"] for r in results]

    exact_matches = sum(1 for a, p in zip(actuals, predicted) if a == p)
    mae = sum(abs(a - p) for a, p in zip(actuals, predicted)) / len(results)
    within_one = sum(1 for a, p in zip(actuals, predicted) if abs(a - p) <= 0.2)

    print("\n" + "=" * 60)
    print("FORECAST EVALUATION RESULTS")
    print("=" * 60)
    print(f"Rows evaluated : {len(results)}")
    print(f"Exact match    : {exact_matches}/{len(results)} ({exact_matches/len(results)*100:.1f}%)")
    print(f"Within 1 step  : {within_one}/{len(results)} ({within_one/len(results)*100:.1f}%)")
    print(f"Mean abs error : {mae:.3f}")
    print()

    # Confusion matrix
    print("CONFUSION MATRIX (rows=actual, cols=predicted)")
    header = "       " + "  ".join(f"{v:.1f}" for v in VALID_LEVELS)
    print(header)
    matrix: dict[float, dict[float, int]] = defaultdict(lambda: defaultdict(int))
    for r in results:
        matrix[r["actual"]][r["predicted"]] += 1
    for actual in VALID_LEVELS:
        row_str = f"  {actual:.1f}  "
        for pred in VALID_LEVELS:
            count = matrix[actual][pred]
            marker = f"[{count}]" if actual == pred else f" {count} "
            row_str += f" {marker}"
        print(row_str)
    print()

    # Large misses
    large_misses = [r for r in results if abs(r["actual"] - r["predicted"]) >= 0.4]
    if large_misses:
        print(f"LARGE MISSES (|actual - predicted| >= 0.4): {len(large_misses)}")
        for r in sorted(large_misses, key=lambda x: abs(x["actual"] - x["predicted"]), reverse=True):
            diff = r["predicted"] - r["actual"]
            direction = "over" if diff > 0 else "under"
            print(f"  Row {r['idx']:2d}: actual={r['actual']:.1f}  predicted={r['predicted']:.1f}  ({direction} by {abs(diff):.1f})")
    else:
        print("No large misses (all within 0.2 of actual).")
    print()

    # Per-category breakdown
    print("PER-CATEGORY ACCURACY")
    cat_groups: dict[float, list] = defaultdict(list)
    for r in results:
        cat_groups[r["actual"]].append(r["predicted"])
    for cat in VALID_LEVELS:
        preds = cat_groups.get(cat, [])
        if not preds:
            continue
        exact = sum(1 for p in preds if p == cat)
        avg_pred = sum(preds) / len(preds)
        print(f"  {cat:.1f} (n={len(preds)}): exact={exact}/{len(preds)}  avg_predicted={avg_pred:.2f}")


def main():
    parser = argparse.ArgumentParser(description="Evaluate forecast model against training data")
    parser.add_argument("--csv", required=True, help="Path to training CSV")
    parser.add_argument("--no-cache", action="store_true", help="Ignore existing cache and re-run all calls")
    parser.add_argument("--synthesis-only", action="store_true", help="Only run synthesis step, skip forecast")
    args = parser.parse_args()

    config = Config.from_env()
    gemini = GeminiClient(config)
    forecaster = ForecastClient(config)

    cache = {} if args.no_cache else load_cache()

    print(f"Loading training data from: {args.csv}")
    rows = load_training_data(args.csv)
    print(f"Loaded {len(rows)} rows\n")

    results = []
    for row in rows:
        print(f"[{row['idx']:2d}/{len(rows)}] actual={row['actual']:.1f}")

        # Step 1: synthesis
        synthesis = run_synthesis(row, gemini, cache)
        if synthesis is None:
            print(f"  Skipping forecast (synthesis failed)")
            continue

        if args.synthesis_only:
            continue

        # Step 2: forecast
        predicted = run_forecast(row["idx"], synthesis, forecaster, cache)
        if predicted is None:
            print(f"  Skipping result (forecast failed)")
            continue

        results.append({
            "idx": row["idx"],
            "actual": row["actual"],
            "predicted": predicted,
        })
        direction = "✓" if predicted == row["actual"] else ("↑" if predicted > row["actual"] else "↓")
        print(f"  predicted={predicted:.1f}  {direction}")

    if results:
        print_results(results)
    elif not args.synthesis_only:
        print("No results to report.")


if __name__ == "__main__":
    main()
