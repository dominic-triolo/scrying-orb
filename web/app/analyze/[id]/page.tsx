'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AnalysisChat from '@/components/AnalysisChat'

interface Job {
  id: string
  query: string
  status: 'queued' | 'running' | 'complete' | 'error' | 'canceled'
  total_transcripts: number
  processed_count: number
  result: AnalysisResult | null
  error: string | null
  created_at: string
}
interface AnalysisResult {
  answer?: string
  key_findings?: string[]
  caveats?: string[]
  stats?: { by_field?: Record<string, Record<string, number>>; total_relevant?: number }
  total_analyzed?: number
  total_relevant?: number
  errors?: number
}
interface Message { role: 'user' | 'assistant'; content: string }

const TERMINAL = new Set(['complete', 'error', 'canceled'])

function titleize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function AnalysisResultPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { id } = params
  const [job, setJob] = useState<Job | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [notFound, setNotFound] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/analysis/${id}`)
      if (res.status === 403) { router.replace('/'); return }
      if (res.status === 404) { setNotFound(true); return }
      const data = await res.json()
      setJob(data.job)
      setMessages(data.messages ?? [])
      if (!TERMINAL.has(data.job.status)) {
        timer.current = setTimeout(poll, 2000)
      }
    } catch {
      timer.current = setTimeout(poll, 4000)
    }
  }, [id, router])

  useEffect(() => {
    poll()
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [poll])

  async function cancel() {
    setCanceling(true)
    try {
      await fetch(`/api/analysis/${id}/cancel`, { method: 'POST' })
      poll()
    } finally {
      setCanceling(false)
    }
  }

  if (notFound) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-sm text-gray-400 mb-3">Analysis not found.</p>
        <Link href="/analyze" className="text-sm text-blue-600 hover:text-blue-800">← Back to analyses</Link>
      </div>
    </div>
  )

  if (!job) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-sm text-gray-400">Loading…</p>
    </div>
  )

  const r = job.result
  const pct = job.total_transcripts ? Math.round((job.processed_count / job.total_transcripts) * 100) : 0
  const running = job.status === 'queued' || job.status === 'running'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-start gap-3 mb-6">
          <Link href="/analyze" className="mt-1 text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Question</p>
            <h1 className="text-lg font-semibold text-gray-900 leading-snug">{job.query}</h1>
          </div>
        </div>

        {/* Running / queued: progress */}
        {running && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-800">
                {job.status === 'queued' ? 'Queued — waiting for a worker…' : `Analyzing ${job.processed_count.toLocaleString()} of ${job.total_transcripts.toLocaleString()} transcripts…`}
              </p>
              <button onClick={cancel} disabled={canceling}
                className="text-xs font-medium text-gray-400 hover:text-red-500 disabled:opacity-50 transition-colors">
                {canceling ? 'Canceling…' : 'Cancel'}
              </button>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-xs text-gray-400">This page updates automatically.</p>
          </div>
        )}

        {job.status === 'canceled' && (
          <div className="rounded-xl bg-gray-100 border border-gray-200 px-5 py-4 mb-6 text-sm text-gray-600">
            This analysis was canceled{job.processed_count ? ` after ${job.processed_count.toLocaleString()} transcripts` : ''}.
          </div>
        )}

        {job.status === 'error' && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-5 py-4 mb-6 text-sm text-red-700">
            <p className="font-medium mb-1">Analysis failed</p>
            <p className="text-red-600">{job.error ?? 'Unknown error'}</p>
          </div>
        )}

        {/* Complete: result */}
        {job.status === 'complete' && r && (
          <div className="space-y-6">
            {/* Meta */}
            <div className="flex flex-wrap gap-4 text-xs text-gray-500">
              <span><strong className="text-gray-800">{(r.total_analyzed ?? 0).toLocaleString()}</strong> analyzed</span>
              <span><strong className="text-gray-800">{(r.total_relevant ?? 0).toLocaleString()}</strong> relevant</span>
              {!!r.errors && <span className="text-amber-600">{r.errors} skipped (errors)</span>}
            </div>

            {/* Answer */}
            {r.answer && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{r.answer}</p>
              </div>
            )}

            {/* Key findings */}
            {r.key_findings && r.key_findings.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Key findings</h2>
                <ul className="space-y-2">
                  {r.key_findings.map((k, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-700">
                      <span className="text-blue-500 mt-0.5">•</span><span>{k}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Stats — deterministic counts */}
            {r.stats?.by_field && Object.keys(r.stats.by_field).length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">Breakdown</h2>
                <div className="space-y-5">
                  {Object.entries(r.stats.by_field).map(([field, counts]) => {
                    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
                    const denom = r.stats?.total_relevant || entries.reduce((s, [, n]) => s + n, 0) || 1
                    const max = Math.max(...entries.map(([, n]) => n), 1)
                    return (
                      <div key={field}>
                        <p className="text-sm font-medium text-gray-700 mb-2">{titleize(field)}</p>
                        <div className="space-y-1.5">
                          {entries.map(([val, n]) => (
                            <div key={val} className="flex items-center gap-3">
                              <span className="w-32 flex-shrink-0 truncate text-xs text-gray-600" title={val}>{val}</span>
                              <div className="flex-1 h-4 rounded bg-gray-100 overflow-hidden">
                                <div className="h-full bg-blue-500/80" style={{ width: `${(n / max) * 100}%` }} />
                              </div>
                              <span className="w-20 flex-shrink-0 text-right text-xs text-gray-500">
                                {n} · {Math.round((n / denom) * 100)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <p className="mt-4 text-xs text-gray-400">Counts are exact; percentages are of the {(r.total_relevant ?? 0).toLocaleString()} relevant transcripts.</p>
              </div>
            )}

            {/* Caveats */}
            {r.caveats && r.caveats.length > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-700 mb-2">Caveats</h2>
                <ul className="space-y-1">
                  {r.caveats.map((c, i) => (
                    <li key={i} className="text-xs text-amber-800">• {c}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Chat */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Ask a follow-up</h2>
              <AnalysisChat jobId={id} initialMessages={messages} />
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
