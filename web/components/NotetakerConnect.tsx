'use client'

import { useEffect, useState } from 'react'

interface CalendarState {
  configured: boolean
  connected: boolean
  status: string | null
}

const FAILURES: Record<string, string> = {
  declined: 'Calendar access was not granted.',
  wrong_account: 'Choose your own TrovaTrip Google account.',
  error: 'Could not connect the calendar. Try again.',
}

/**
 * Sidebar control for the Recall.ai notetaker: connect or disconnect the signed-in
 * rep's Google Calendar. While connected, the notetaker bot auto-joins their Google
 * Meet calls that include someone outside TrovaTrip.
 */
export default function NotetakerConnect() {
  const [state, setState] = useState<CalendarState | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = () =>
    fetch('/api/recall/calendar')
      .then((r) => (r.ok ? r.json() : null))
      .then(setState)
      .catch(() => {})

  useEffect(() => {
    load()
    // The connect callback lands back on the home page with ?notetaker=<result>.
    const result = new URLSearchParams(window.location.search).get('notetaker')
    if (result && result !== 'connected') setNotice(FAILURES[result] ?? FAILURES.error)
  }, [])

  if (!state?.configured) return null

  const disconnect = async () => {
    if (!window.confirm('Stop the notetaker from joining your calls?')) return
    setBusy(true)
    await fetch('/api/recall/calendar', { method: 'DELETE' }).catch(() => {})
    await load()
    setBusy(false)
  }

  // A row that exists but isn't 'connected' means Google access was revoked or expired.
  const lapsed = !state.connected && state.status !== null

  return (
    <div className="mb-3 rounded-md bg-slate-800 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${state.connected ? 'bg-emerald-400' : lapsed ? 'bg-amber-400' : 'bg-slate-500'}`} />
          <span className="text-xs font-medium text-white truncate">Notetaker</span>
        </div>
        {state.connected ? (
          <button
            onClick={disconnect}
            disabled={busy}
            className="text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            Disconnect
          </button>
        ) : (
          <a
            href="/api/recall/calendar/connect"
            className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
          >
            {lapsed ? 'Reconnect' : 'Connect calendar'}
          </a>
        )}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-slate-400">
        {state.connected
          ? 'Joins your Google Meet calls with external guests.'
          : lapsed
            ? 'Calendar access lapsed — calls are not being recorded.'
            : 'Connect to have calls recorded automatically.'}
      </p>
      {notice && !state.connected && (
        <p className="mt-1 text-[11px] leading-snug text-amber-400">{notice}</p>
      )}
    </div>
  )
}
