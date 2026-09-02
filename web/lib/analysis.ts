import type { AnalysisFilters } from './db'

/** Normalize an untrusted request body into clean AnalysisFilters. */
export function parseFilters(body: Record<string, unknown>): AnalysisFilters {
  const arr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((s) => s.trim())
      : []
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : null
  return {
    meeting_types: arr(body.meeting_types),
    reps: arr(body.reps),
    date_from: str(body.date_from),
    date_to: str(body.date_to),
  }
}

// Estimate math — kept in sync with the worker's MAP_CONCURRENCY (synthesis/analysis.py).
export const MAP_CONCURRENCY = 5
export const PER_TRANSCRIPT_SECONDS = 5
export const OVERHEAD_SECONDS = 20 // plan + reduce
export const WARN_THRESHOLD = 300

export function estimateSeconds(count: number): number {
  return Math.ceil(count / MAP_CONCURRENCY) * PER_TRANSCRIPT_SECONDS + OVERHEAD_SECONDS
}
