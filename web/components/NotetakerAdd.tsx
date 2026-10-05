'use client'

import { useState } from 'react'

const INPUT =
  'w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

/**
 * "Add to a meeting": send the notetaker into a Google Meet right now. The manual
 * fallback for a call it didn't join on its own.
 */
export default function NotetakerAdd() {
  const [open, setOpen] = useState(false)
  const [meetingUrl, setMeetingUrl] = useState('')
  const [meetingName, setMeetingName] = useState('')
  const [guests, setGuests] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/recall/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting_url: meetingUrl, meeting_name: meetingName, external_attendees: guests,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
      setSent(true)
      setMeetingUrl(''); setMeetingName(''); setGuests('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setSent(false) }}
        className="mt-2 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
      >
        Add to a meeting
      </button>
    )
  }

  if (sent) {
    return (
      <div className="mt-2 border-t border-slate-700 pt-2">
        <p className="text-[11px] leading-snug text-emerald-400">
          The notetaker is joining. It can take up to a minute to appear.
        </p>
        <button onClick={() => setOpen(false)} className="mt-1 text-xs text-slate-400 hover:text-white">
          Done
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="mt-2 border-t border-slate-700 pt-2 space-y-1.5">
      <input
        className={INPUT} placeholder="Google Meet link" required
        value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)}
      />
      <input
        className={INPUT} placeholder="Meeting title (e.g. Intro Call: Host)" required
        value={meetingName} onChange={(e) => setMeetingName(e.target.value)}
      />
      <input
        className={INPUT} placeholder="Guest email(s)"
        value={guests} onChange={(e) => setGuests(e.target.value)}
      />
      {error && <p className="text-[11px] leading-snug text-amber-400">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit" disabled={busy}
          className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send notetaker'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:text-white">
          Cancel
        </button>
      </div>
    </form>
  )
}
