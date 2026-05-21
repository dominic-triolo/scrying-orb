'use client'

import { useMemo, useRef, useState } from 'react'
import type { Contact, Deal } from '@/lib/db'
import RichEditor from '@/components/RichEditor'

interface OutreachPanelProps {
  meetingId: string
  summaryText: string | null
  contacts: Contact[]
}

function collectDeals(contacts: Contact[]): Deal[] {
  const seen = new Set<string>()
  const deals: Deal[] = []
  for (const c of contacts) {
    for (const d of c.deals ?? []) {
      if (!seen.has(d.id)) { seen.add(d.id); deals.push(d) }
    }
  }
  return deals
}

// Convert plain text lines → HTML paragraphs for the rich editor
function plainToHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => `<p>${line.trim() || '<br>'}</p>`)
    .join('')
}

// ── Main component ─────────────────────────────────────────────────────────
export default function OutreachPanel({ meetingId, summaryText, contacts }: OutreachPanelProps) {
  const allDeals = useMemo(() => collectDeals(contacts), [contacts])
  const bodyRef = useRef<HTMLDivElement>(null)

  // HubSpot note state
  const [noteBody, setNoteBody] = useState(summaryText ?? '')
  const [selectedDealIds, setSelectedDealIds] = useState<Set<string>>(
    () => new Set(allDeals.map((d) => d.id))
  )
  const [noteSubmitting, setNoteSubmitting] = useState(false)
  const [noteSuccess, setNoteSuccess] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  // Note generation state
  const [generatingNote, setGeneratingNote] = useState(false)
  const [noteGenError, setNoteGenError] = useState<string | null>(null)

  // Email state
  const [emailDraft, setEmailDraft] = useState<{
    to: string; cc: string; subject: string; body: string
  } | null>(null)
  const [editorHtml, setEditorHtml] = useState('')
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)

  function toggleDeal(id: string) {
    setSelectedDealIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function generateNote() {
    setGeneratingNote(true); setNoteGenError(null)
    try {
      const res = await fetch(`/api/meetings/${meetingId}/generate-note`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to generate note')
      setNoteBody(data.note)
    } catch (err: unknown) {
      setNoteGenError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setGeneratingNote(false)
    }
  }

  async function submitNote() {
    setNoteSubmitting(true); setNoteError(null)
    try {
      const res = await fetch(`/api/meetings/${meetingId}/hubspot-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteBody, dealIds: Array.from(selectedDealIds) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to post note')
      setNoteSuccess(true)
    } catch (err: unknown) {
      setNoteError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setNoteSubmitting(false)
    }
  }

  async function generateDraft() {
    setGenerating(true); setEmailError(null); setEmailSent(false)
    try {
      const res = await fetch(`/api/meetings/${meetingId}/draft-email`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to generate draft')
      const html = plainToHtml(data.body)
      setEmailDraft({ to: data.to, cc: '', subject: data.subject, body: html })
      setEditorHtml(html)
    } catch (err: unknown) {
      setEmailError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setGenerating(false)
    }
  }

  async function sendEmail() {
    if (!emailDraft) return
    const htmlBody = bodyRef.current?.innerHTML ?? ''
    setSending(true); setEmailError(null)
    try {
      const res = await fetch(`/api/meetings/${meetingId}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...emailDraft, body: htmlBody }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to send email')
      setEmailSent(true)
    } catch (err: unknown) {
      setEmailError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-8 max-w-3xl">

      {/* ── HubSpot Note ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">HubSpot Note</h3>
        <p className="text-xs text-gray-500 mb-4">
          Post a note to one or more linked deals. Pre-filled from the AI summary — edit as needed.
        </p>

        {noteSuccess ? (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-4 py-3">
            <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Note posted to HubSpot successfully.
          </div>
        ) : (
          <>
            {allDeals.length === 0 ? (
              <p className="text-sm text-amber-600 bg-amber-50 rounded-lg px-4 py-3 mb-4">
                No HubSpot deals linked to this meeting. The synthesis service links deals automatically when a matching contact is found.
              </p>
            ) : (
              <div className="mb-4">
                <p className="text-xs font-medium text-gray-500 mb-2">Post to</p>
                <div className="space-y-2">
                  {allDeals.map((deal) => (
                    <label key={deal.id}
                      className="flex items-start gap-3 rounded-lg border border-gray-200 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <input type="checkbox" checked={selectedDealIds.has(deal.id)}
                        onChange={() => toggleDeal(deal.id)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{deal.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{deal.pipeline} · {deal.stage}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={6}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              placeholder="Meeting summary…"
            />
            {noteGenError && <p className="mt-2 text-xs text-red-600">{noteGenError}</p>}
            {noteError && <p className="mt-2 text-xs text-red-600">{noteError}</p>}
            <div className="mt-3 flex items-center justify-between">
              <button onClick={generateNote} disabled={generatingNote}
                className="text-xs text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
              >
                {generatingNote ? 'Generating…' : noteBody.trim() ? 'Regenerate with AI' : 'Generate with AI'}
              </button>
              <button onClick={submitNote}
                disabled={noteSubmitting || !noteBody.trim() || selectedDealIds.size === 0}
                className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                {noteSubmitting ? 'Posting…' : `Post to HubSpot${selectedDealIds.size > 1 ? ` (${selectedDealIds.size} deals)` : ''}`}
              </button>
            </div>

          </>
        )}
      </section>

      {/* ── Follow-up Email ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Follow-up Email</h3>
        <p className="text-xs text-gray-500 mb-4">
          Draft a follow-up to the prospect using the meeting summary. Edit before sending.
        </p>

        {!emailDraft ? (
          <>
            <button onClick={generateDraft} disabled={generating}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {generating ? 'Drafting…' : 'Generate Draft'}
            </button>
            {emailError && <p className="mt-2 text-xs text-red-600">{emailError}</p>}
          </>
        ) : emailSent ? (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-4 py-3">
            <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Email sent successfully.
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
              <input type="text" value={emailDraft.to}
                onChange={(e) => setEmailDraft({ ...emailDraft, to: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">CC</label>
              <input type="text" value={emailDraft.cc}
                onChange={(e) => setEmailDraft({ ...emailDraft, cc: e.target.value })}
                placeholder="optional, comma-separated"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
              <input type="text" value={emailDraft.subject}
                onChange={(e) => setEmailDraft({ ...emailDraft, subject: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Body</label>
              <RichEditor initialHtml={editorHtml} editorRef={bodyRef} />
            </div>
            {emailError && <p className="text-xs text-red-600">{emailError}</p>}
            <div className="flex items-center justify-between pt-1">
              <button onClick={generateDraft} disabled={generating}
                className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                {generating ? 'Regenerating…' : 'Regenerate'}
              </button>
              <button onClick={sendEmail}
                disabled={sending || !emailDraft.to || !emailDraft.subject}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {sending ? 'Sending…' : 'Send Email'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
