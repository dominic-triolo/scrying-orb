'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { NotetakerCall, NotetakerStatus } from '@/lib/db'

type Tone = 'ok' | 'warn' | 'bad' | 'idle'

const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-700',
  bad: 'bg-red-50 text-red-700',
  idle: 'bg-gray-100 text-gray-500',
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  )
}

function synthesisPill(call: NotetakerCall) {
  if (call.status === 'complete') return <Pill tone="ok">Synthesized</Pill>
  if (call.status === 'error') return <Pill tone="bad">Failed</Pill>
  return <Pill tone="warn">Waiting</Pill>
}

function recordingPill(call: NotetakerCall) {
  if (call.status !== 'complete') return <Pill tone="idle">—</Pill>
  if (call.media_status === 'copied') return <Pill tone="ok">Saved</Pill>
  if (call.media_status === 'error') return <Pill tone="bad">Copy failed</Pill>
  if (call.media_status === 'none') return <Pill tone="idle">No video</Pill>
  return <Pill tone="warn">Copying</Pill>
}

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function NotetakerStatusPage() {
  const router = useRouter()
  const [data, setData] = useState<NotetakerStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [onlyProblems, setOnlyProblems] = useState(false)

  useEffect(() => {
    // Gate to admins only
    fetch('/api/me').then((r) => r.json()).then((d) => {
      if (!d.isLeadership) router.replace('/')
    })
    fetch('/api/recall/status')
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.error ?? 'Failed to load')
        setData(body)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Unknown error'))
  }, [router])

  if (!data && !error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-sm text-gray-400">Loading…</p>
    </div>
  )

  const calendars = data?.calendars ?? []
  const calls = data?.calls ?? []
  const isProblem = (c: NotetakerCall) => c.status === 'error' || c.media_status === 'error'
  const lapsed = calendars.filter((c) => c.status !== 'connected')
  const failed = calls.filter(isProblem)
  const shown = onlyProblems ? failed : calls

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link href="/" className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Notetaker Status</h1>
            <p className="text-sm text-gray-500 mt-0.5">Who has the notetaker connected, and what happened to each recent call.</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Calendars connected', value: calendars.length - lapsed.length, bad: false },
            { label: 'Calendars needing reconnect', value: lapsed.length, bad: lapsed.length > 0 },
            { label: `Failed calls (last ${calls.length})`, value: failed.length, bad: failed.length > 0 },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
              <p className={`text-2xl font-semibold ${s.bad ? 'text-red-600' : 'text-gray-900'}`}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Calendars */}
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Calendars</h2>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-8">
          {calendars.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">Nobody has connected a calendar yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="px-4 py-2 font-medium">Rep</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Connected</th>
                </tr>
              </thead>
              <tbody>
                {calendars.map((c) => (
                  <tr key={c.email} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2 text-gray-900">{c.email}</td>
                    <td className="px-4 py-2">
                      {c.status === 'connected'
                        ? <Pill tone="ok">Connected</Pill>
                        : <Pill tone="bad">Needs reconnect</Pill>}
                      {c.sync_pending && <span className="ml-2 text-xs text-gray-400">syncing…</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-500">{when(c.connected_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Calls */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Recent calls</h2>
          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyProblems}
              onChange={(e) => setOnlyProblems(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Failures only
          </label>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {shown.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">
              {onlyProblems ? 'No failures.' : 'No calls have come through the notetaker yet.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="px-4 py-2 font-medium">Received</th>
                  <th className="px-4 py-2 font-medium">Meeting</th>
                  <th className="px-4 py-2 font-medium">Rep</th>
                  <th className="px-4 py-2 font-medium">Synthesis</th>
                  <th className="px-4 py-2 font-medium">Recording</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.bot_id} className="border-b border-gray-100 last:border-0 align-top">
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{when(c.received_at)}</td>
                    <td className="px-4 py-2">
                      {c.meeting_id ? (
                        <Link href={`/meetings/${c.meeting_id}`} className="text-blue-600 hover:underline">
                          {c.meeting_name}
                        </Link>
                      ) : (
                        <span className="text-gray-400">Not in the orb</span>
                      )}
                      {isProblem(c) && (
                        <p className="mt-1 text-xs text-red-600 break-words">
                          {c.status === 'error' ? c.notes : c.media_notes}
                        </p>
                      )}
                      <p className="mt-0.5 text-[11px] text-gray-400 font-mono">bot {c.bot_id}</p>
                    </td>
                    <td className="px-4 py-2 text-gray-500">{c.recording_owner ?? '—'}</td>
                    <td className="px-4 py-2">{synthesisPill(c)}</td>
                    <td className="px-4 py-2">{recordingPill(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
