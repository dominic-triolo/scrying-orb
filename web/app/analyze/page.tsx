'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface MeetingType { id: string; label: string }
interface Estimate { count: number; estimatedSeconds: number; warn: boolean; warnThreshold: number }
interface JobSummary {
  id: string
  query: string
  status: string
  total_transcripts: number
  processed_count: number
  created_at: string
}

function fmtDuration(sec: number): string {
  if (sec < 90) return `~${Math.max(1, Math.round(sec))} sec`
  const min = Math.round(sec / 60)
  if (min < 60) return `~${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `~${h} hr ${m} min` : `~${h} hr`
}

const STATUS_STYLE: Record<string, string> = {
  queued: 'bg-amber-100 text-amber-700',
  running: 'bg-blue-100 text-blue-700',
  complete: 'bg-emerald-100 text-emerald-700',
  error: 'bg-red-100 text-red-700',
  canceled: 'bg-gray-100 text-gray-500',
}

export default function AnalyzePage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  const [query, setQuery] = useState('')
  const [types, setTypes] = useState<MeetingType[]>([])
  const [reps, setReps] = useState<string[]>([])
  const [selTypes, setSelTypes] = useState<Set<string>>(new Set())
  const [selReps, setSelReps] = useState<Set<string>>(new Set())
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [estimating, setEstimating] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [recent, setRecent] = useState<JobSummary[]>([])

  useEffect(() => {
    // Leadership gate
    fetch('/api/me').then((r) => r.json()).then((d) => {
      if (!d.isLeadership) { router.replace('/'); return }
      setReady(true)
    }).catch(() => router.replace('/'))

    fetch('/api/meeting-types').then((r) => r.json()).then(setTypes).catch(() => {})
    fetch('/api/reps').then((r) => r.ok ? r.json() : { reps: [] }).then((d) => setReps(d.reps ?? [])).catch(() => {})
    loadRecent()
  }, [router])

  function loadRecent() {
    fetch('/api/analysis').then((r) => r.ok ? r.json() : { jobs: [] }).then((d) => setRecent(d.jobs ?? [])).catch(() => {})
  }

  const filters = useMemo(() => ({
    meeting_types: Array.from(selTypes),
    reps: Array.from(selReps),
    date_from: dateFrom || null,
    date_to: dateTo || null,
  }), [selTypes, selReps, dateFrom, dateTo])

  // Any filter change invalidates a shown estimate
  useEffect(() => { setEstimate(null) }, [filters, query])

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, v: string) {
    const next = new Set(set)
    next.has(v) ? next.delete(v) : next.add(v)
    setter(next)
  }

  async function review() {
    setError(null); setEstimating(true); setEstimate(null)
    try {
      const res = await fetch('/api/analysis/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to estimate')
      setEstimate(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setEstimating(false)
    }
  }

  async function start() {
    setError(null); setStarting(true)
    try {
      const res = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), ...filters }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to start analysis')
      router.push(`/analyze/${data.id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setStarting(false)
    }
  }

  if (!ready) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-sm text-gray-400">Loading…</p>
    </div>
  )

  const canReview = query.trim().length > 0 && !estimating

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link href="/" className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Transcript Analysis</h1>
            <p className="text-sm text-gray-500 mt-0.5">Ask one question across many call transcripts at once.</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Form */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
          {/* Question */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Your question</label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={3}
              placeholder="e.g. On intro calls, did the rep do discovery and collaborate with the host to pick the next step, or default to 'survey'?"
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Meeting types */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Meeting types <span className="text-gray-400">· none selected = all</span></label>
            <div className="flex flex-wrap gap-2">
              {types.map((t) => {
                const on = selTypes.has(t.id)
                return (
                  <button key={t.id} type="button" onClick={() => toggle(selTypes, setSelTypes, t.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                      on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                    }`}>
                    {t.label}
                  </button>
                )
              })}
              {types.length === 0 && <span className="text-xs text-gray-400">No meeting types.</span>}
            </div>
          </div>

          {/* Reps */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Sales reps <span className="text-gray-400">· none selected = all</span></label>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
              {reps.map((r) => {
                const on = selReps.has(r)
                return (
                  <button key={r} type="button" onClick={() => toggle(selReps, setSelReps, r)}
                    className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                      on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                    }`}>
                    {r}
                  </button>
                )
              })}
              {reps.length === 0 && <span className="text-xs text-gray-400">No reps found.</span>}
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {/* Review / Estimate + Confirm */}
          {!estimate ? (
            <button onClick={review} disabled={!canReview}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {estimating ? 'Checking…' : 'Review & estimate'}
            </button>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
              {estimate.count === 0 ? (
                <p className="text-sm text-gray-600">No transcripts match these filters. Adjust and try again.</p>
              ) : (
                <>
                  <p className="text-sm text-gray-800">
                    This will analyze <strong>{estimate.count.toLocaleString()}</strong> transcript{estimate.count === 1 ? '' : 's'}
                    {' '}· estimated <strong>{fmtDuration(estimate.estimatedSeconds)}</strong>.
                  </p>
                  {estimate.warn && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                      ⚠ That&apos;s a large run (over {estimate.warnThreshold.toLocaleString()} transcripts). It will take a while and use a lot of Gemini calls. You can narrow the filters to cut it down.
                    </p>
                  )}
                  <div className="flex items-center gap-3">
                    <button onClick={start} disabled={starting}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                      {starting ? 'Starting…' : 'Confirm & run'}
                    </button>
                    <button onClick={() => setEstimate(null)} className="text-sm text-gray-500 hover:text-gray-700">
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Recent analyses */}
        <div className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Recent analyses</h2>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {recent.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-gray-400">No analyses yet.</p>
            )}
            {recent.map((j) => (
              <Link key={j.id} href={`/analyze/${j.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[j.status] ?? 'bg-gray-100 text-gray-500'}`}>
                  {j.status === 'running' ? `${j.processed_count}/${j.total_transcripts}` : j.status}
                </span>
                <span className="flex-1 min-w-0 truncate text-sm text-gray-800">{j.query}</span>
                <span className="flex-shrink-0 text-xs text-gray-400">{new Date(j.created_at).toLocaleDateString()}</span>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
