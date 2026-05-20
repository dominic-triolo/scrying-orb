'use client'

import { useState } from 'react'

interface Contact {
  email: string
  hubspot_contact_id: string | null
}

interface OutreachPanelProps {
  meetingId: string
  hubspotDealId: string | null
  summaryText: string | null
  contacts: Contact[]
}

export default function OutreachPanel({
  meetingId,
  hubspotDealId,
  summaryText,
  contacts,
}: OutreachPanelProps) {
  // --- HubSpot note state ---
  const [noteBody, setNoteBody] = useState(summaryText ?? '')
  const [noteSubmitting, setNoteSubmitting] = useState(false)
  const [noteSuccess, setNoteSuccess] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  // --- Email state ---
  const [emailDraft, setEmailDraft] = useState<{
    to: string
    subject: string
    body: string
  } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)

  async function submitNote() {
    setNoteSubmitting(true)
    setNoteError(null)
    try {
      const res = await fetch(`/api/meetings/${meetingId}/hubspot-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteBody }),
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
    setGenerating(true)
    setEmailError(null)
    setEmailSent(false)
    try {
      const res = await fetch(`/api/meetings/${meetingId}/draft-email`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to generate draft')
      setEmailDraft(data)
    } catch (err: unknown) {
      setEmailError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setGenerating(false)
    }
  }

  async function sendEmail() {
    if (!emailDraft) return
    setSending(true)
    setEmailError(null)
    try {
      const res = await fetch(`/api/meetings/${meetingId}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emailDraft),
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
          Post a note to the linked deal. Pre-filled from the AI summary — edit as needed.
        </p>

        {!hubspotDealId ? (
          <p className="text-sm text-amber-600 bg-amber-50 rounded-lg px-4 py-3">
            No HubSpot deal is linked to this meeting. The synthesis service links deals automatically when a matching contact is found.
          </p>
        ) : noteSuccess ? (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-4 py-3">
            <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Note posted to HubSpot successfully.
          </div>
        ) : (
          <>
            <textarea
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              rows={6}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              placeholder="Meeting summary…"
            />
            {noteError && (
              <p className="mt-2 text-xs text-red-600">{noteError}</p>
            )}
            <div className="mt-3 flex justify-end">
              <button
                onClick={submitNote}
                disabled={noteSubmitting || !noteBody.trim()}
                className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                {noteSubmitting ? 'Posting…' : 'Post to HubSpot'}
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

        {contacts.length === 0 && (
          <p className="text-sm text-amber-600 bg-amber-50 rounded-lg px-4 py-3 mb-4">
            No external contacts recorded — the email will need a recipient address.
          </p>
        )}

        {!emailDraft ? (
          <>
            <button
              onClick={generateDraft}
              disabled={generating}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {generating ? 'Drafting…' : 'Generate Draft'}
            </button>
            {emailError && (
              <p className="mt-2 text-xs text-red-600">{emailError}</p>
            )}
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
              <input
                type="text"
                value={emailDraft.to}
                onChange={(e) => setEmailDraft({ ...emailDraft, to: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
              <input
                type="text"
                value={emailDraft.subject}
                onChange={(e) => setEmailDraft({ ...emailDraft, subject: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Body</label>
              <textarea
                value={emailDraft.body}
                onChange={(e) => setEmailDraft({ ...emailDraft, body: e.target.value })}
                rows={10}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </div>
            {emailError && (
              <p className="text-xs text-red-600">{emailError}</p>
            )}
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={generateDraft}
                disabled={generating}
                className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                {generating ? 'Regenerating…' : 'Regenerate'}
              </button>
              <button
                onClick={sendEmail}
                disabled={sending || !emailDraft.to || !emailDraft.subject || !emailDraft.body}
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
