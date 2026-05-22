'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import TypeBadge from '@/components/TypeBadge'
import SynthesisPanel from '@/components/SynthesisPanel'
import OutreachPanel from '@/components/OutreachPanel'
import AskPanel from '@/components/AskPanel'
import CoachingPanel from '@/components/CoachingPanel'
import type { MeetingDetail } from '@/lib/db'

const MEETING_TYPES = ['intro', 'planning', 'nurture']
const SCOREABLE_TYPES = ['intro', 'planning']

function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown date'
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

type Tab = 'analysis' | 'transcript' | 'attendees' | 'outreach' | 'ask' | 'coaching'

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('analysis')
  const [isLeadershipUser, setIsLeadershipUser] = useState(false)
  const [typeEdit, setTypeEdit] = useState(false)
  const [savingType, setSavingType] = useState(false)
  const [selectedType, setSelectedType] = useState('')
  const [cachedNote, setCachedNote] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/me')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.isLeadership) setIsLeadershipUser(true) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch(`/api/meetings/${id}`)
      .then((r) => {
        if (r.status === 403 || r.status === 404) { router.push('/'); return null }
        return r.json()
      })
      .then((data) => {
        if (!data) return
        setMeeting(data)
        setSelectedType(data.meeting_type ?? 'nurture')
      })
      .finally(() => setLoading(false))
  }, [id, router])

  async function saveType() {
    if (!meeting) return
    setSavingType(true)
    const res = await fetch(`/api/meetings/${id}/type`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: selectedType }),
    })
    if (res.ok) {
      setMeeting((m) => m ? { ...m, meeting_type: selectedType, meeting_type_source: 'manual', synthesis_output: null } : m)
    }
    setSavingType(false)
    setTypeEdit(false)
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-gray-400 text-sm">Loading meeting…</p>
      </div>
    )
  }

  if (!meeting) return null

  const isScoreable = SCOREABLE_TYPES.includes(meeting.meeting_type ?? '')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'analysis', label: 'AI Analysis' },
    { key: 'transcript', label: 'Transcript' },
    { key: 'attendees', label: `Attendees (${meeting.contacts.length})` },
    { key: 'outreach', label: 'Outreach' },
    { key: 'ask', label: 'Ask' },
    ...(isScoreable ? [{ key: 'coaching' as Tab, label: 'Coaching' }] : []),
  ]

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Minimal sidebar for detail page */}
      <aside className="flex h-screen w-64 flex-shrink-0 flex-col bg-slate-900 text-white">
        <div className="flex items-center gap-2 px-5 py-5 border-b border-slate-700">
          <div className="h-7 w-7 rounded-md bg-blue-500 flex items-center justify-center text-white font-bold text-sm">T</div>
          <span className="font-semibold text-sm tracking-wide">TrovaTrip Meetings</span>
        </div>
        <nav className="px-3 pt-4 space-y-1">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Meetings
          </Link>
          <Link
            href="/templates"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Templates
          </Link>
          {isLeadershipUser && (
            <Link
              href="/scorecard-setup"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              Scorecard Setup
            </Link>
          )}
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-gray-900 leading-snug">{meeting.meeting_name}</h1>
              <p className="text-sm text-gray-500 mt-1">{formatDate(meeting.meeting_datetime)}</p>
            </div>

            {/* Meeting type */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {typeEdit ? (
                <>
                  <select
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {MEETING_TYPES.map((t) => (
                      <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                  <button
                    onClick={saveType}
                    disabled={savingType}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {savingType ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => setTypeEdit(false)}
                    className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <TypeBadge type={meeting.meeting_type} />
                  {meeting.meeting_type_source === 'default' && (
                    <span className="text-xs text-gray-400 italic">(auto)</span>
                  )}
                  <button
                    onClick={() => setTypeEdit(true)}
                    className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    Edit
                  </button>
                </>
              )}
            </div>
          </div>

          {meeting.synthesis_output === null && meeting.meeting_type && (
            <p className="mt-3 text-xs text-amber-600 bg-amber-50 rounded-md px-3 py-2 inline-block">
              Re-synthesis queued — the service will reprocess this meeting with the updated type shortly.
            </p>
          )}
        </div>

        {/* Recording */}
        {meeting.recording_file_id ? (
          <div className="px-8 pt-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Recording</h2>
            <div className="rounded-xl overflow-hidden border border-gray-200 bg-black aspect-video w-full max-w-3xl">
              <iframe
                src={`https://drive.google.com/file/d/${meeting.recording_file_id}/preview`}
                className="w-full h-full"
                allow="autoplay"
                title="Meeting recording"
              />
            </div>
          </div>
        ) : (
          <div className="px-8 pt-6">
            <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-8 text-center max-w-3xl">
              <p className="text-sm text-gray-400">No recording available for this meeting.</p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="px-8 pt-6">
          <div className="border-b border-gray-200 mb-6">
            <nav className="flex gap-6">
              {tabs.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                    tab === key
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>

          <div className="pb-12 max-w-3xl">
            {tab === 'analysis' && (
              <SynthesisPanel synthesis={meeting.synthesis_output} />
            )}

            {tab === 'transcript' && (
              meeting.transcript_text ? (
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <pre className="text-sm text-gray-700 prose-pre leading-relaxed">{meeting.transcript_text}</pre>
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">Transcript not yet available.</p>
              )
            )}

            {tab === 'ask' && (
              <AskPanel
                meetingId={meeting.id}
                hasTranscript={!!meeting.transcript_text}
              />
            )}

            {tab === 'outreach' && (
              <OutreachPanel
                meetingId={meeting.id}
                summaryText={
                  typeof meeting.synthesis_output?.summary === 'string'
                    ? meeting.synthesis_output.summary
                    : null
                }
                contacts={meeting.contacts}
                cachedNote={cachedNote}
                onNoteGenerated={setCachedNote}
              />
            )}

            {tab === 'coaching' && isScoreable && (
              <CoachingPanel meetingId={meeting.id} />
            )}

            {tab === 'attendees' && (
              <div className="space-y-3">
                {/* Rep */}
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">TrovaTrip Rep</p>
                  <p className="text-sm text-gray-800">{meeting.recording_owner ?? '—'}</p>
                  {meeting.rep_talk_pct != null && (
                    <p className="text-xs text-gray-400 mt-1">Talk ratio: {meeting.rep_talk_pct}%</p>
                  )}
                </div>

                {/* External attendees */}
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">External Attendees</p>
                  {meeting.contacts.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">No external attendees recorded.</p>
                  ) : (
                    <ul className="space-y-2">
                      {meeting.contacts.map((c) => (
                        <li key={c.email} className="flex items-center justify-between">
                          <span className="text-sm text-gray-800">{c.email}</span>
                          {c.hubspot_contact_id && process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID && (
                            <a
                              href={`https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID}/contact/${c.hubspot_contact_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline"
                            >
                              HubSpot ↗
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {meeting.prospect_talk_pct != null && (
                    <p className="text-xs text-gray-400 mt-3">Talk ratio: {meeting.prospect_talk_pct}%</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
