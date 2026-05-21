'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import RichEditor from '@/components/RichEditor'
import type { Template, ApprovedLink } from '@/lib/db'

const MEETING_TYPES = ['intro', 'planning', 'nurture'] as const
type MeetingType = typeof MEETING_TYPES[number]

const TYPE_LABELS: Record<MeetingType, string> = {
  intro:    'Intro Call',
  planning: 'Planning Call',
  nurture:  'Nurture Call',
}

type ActiveTab = MeetingType | 'links'

export default function TemplatesPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('intro')
  const [templates, setTemplates] = useState<Record<string, Template>>({})
  const [links, setLinks] = useState<ApprovedLink[]>([])
  const [loading, setLoading] = useState(true)

  // Per-type save state
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})

  // Subject is plain text — controlled per type
  const [subjects, setSubjects] = useState<Record<string, string>>({})

  // Editor refs — one note + one email body per meeting type
  const introNoteRef    = useRef<HTMLDivElement>(null)
  const introBodyRef    = useRef<HTMLDivElement>(null)
  const planningNoteRef = useRef<HTMLDivElement>(null)
  const planningBodyRef = useRef<HTMLDivElement>(null)
  const nurtureNoteRef  = useRef<HTMLDivElement>(null)
  const nurtureBodyRef  = useRef<HTMLDivElement>(null)

  const editorRefs: Record<MeetingType, { note: React.RefObject<HTMLDivElement>; emailBody: React.RefObject<HTMLDivElement> }> = {
    intro:    { note: introNoteRef,    emailBody: introBodyRef },
    planning: { note: planningNoteRef, emailBody: planningBodyRef },
    nurture:  { note: nurtureNoteRef,  emailBody: nurtureBodyRef },
  }

  // Link add state
  const [newUrl, setNewUrl] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [addingLink, setAddingLink] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/templates')
      .then((r) => r.json())
      .then(({ templates: rows, links: linkRows }) => {
        const map: Record<string, Template> = {}
        for (const t of rows) map[t.meeting_type] = t
        for (const type of MEETING_TYPES) {
          if (!map[type]) map[type] = { meeting_type: type, note_example: '', email_subject_example: '', email_body_example: '' }
        }
        setTemplates(map)
        const subjectMap: Record<string, string> = {}
        for (const type of MEETING_TYPES) {
          subjectMap[type] = map[type].email_subject_example ?? ''
        }
        setSubjects(subjectMap)
        setLinks(linkRows)
      })
      .finally(() => setLoading(false))
  }, [])

  async function saveTemplate(type: MeetingType) {
    setSaving((prev) => ({ ...prev, [type]: true }))
    const refs = editorRefs[type]
    const note_example = refs.note.current?.innerHTML ?? ''
    const email_body_example = refs.emailBody.current?.innerHTML ?? ''
    const email_subject_example = subjects[type] ?? ''

    await fetch(`/api/templates/${type}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_example, email_subject_example, email_body_example }),
    })

    setTemplates((prev) => ({
      ...prev,
      [type]: { ...prev[type], note_example, email_subject_example, email_body_example },
    }))

    setSaving((prev) => ({ ...prev, [type]: false }))
    setSaved((prev) => ({ ...prev, [type]: true }))
    setTimeout(() => setSaved((prev) => ({ ...prev, [type]: false })), 2000)
  }

  async function addLink() {
    if (!newUrl.trim() || !newLabel.trim()) return
    setAddingLink(true)
    setLinkError(null)
    try {
      const res = await fetch('/api/templates/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl.trim(), label: newLabel.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setLinks((prev) => [...prev, data])
      setNewUrl('')
      setNewLabel('')
    } catch (err: unknown) {
      setLinkError(err instanceof Error ? err.message : 'Failed to add link')
    } finally {
      setAddingLink(false)
    }
  }

  async function removeLink(id: string) {
    await fetch(`/api/templates/links/${id}`, { method: 'DELETE' })
    setLinks((prev) => prev.filter((l) => l.id !== id))
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex h-screen w-64 flex-shrink-0 flex-col bg-slate-900 text-white">
        <div className="flex items-center gap-2 px-5 py-5 border-b border-slate-700">
          <div className="h-7 w-7 rounded-md bg-blue-500 flex items-center justify-center text-white font-bold text-sm">T</div>
          <span className="font-semibold text-sm tracking-wide">TrovaTrip Meetings</span>
        </div>
        <nav className="px-3 pt-4 space-y-1">
          <Link href="/"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Meetings
          </Link>
          <Link href="/templates"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium bg-slate-800 text-white transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Templates
          </Link>
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-gray-50">
        <div className="bg-white border-b border-gray-200 px-8 py-6">
          <h1 className="text-xl font-bold text-gray-900">Templates</h1>
          <p className="text-sm text-gray-500 mt-1">
            Add example notes and emails per meeting type to guide AI generation. Add approved links that Gemini can include in emails.
          </p>
        </div>

        <div className="px-8 pt-6">
          {/* Tabs */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="flex gap-6">
              {MEETING_TYPES.map((type) => (
                <button key={type} onClick={() => setActiveTab(type)}
                  className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === type ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {TYPE_LABELS[type]}
                </button>
              ))}
              <button onClick={() => setActiveTab('links')}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'links' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Approved Links
              </button>
            </nav>
          </div>

          {/* Meeting type template editor */}
          {activeTab !== 'links' && (() => {
            const type = activeTab as MeetingType
            const t = templates[type] ?? {}
            const refs = editorRefs[type]
            return (
              <div className="max-w-3xl space-y-6 pb-12">
                {/* HubSpot Note */}
                <section className="bg-white rounded-xl border border-gray-200 p-6">
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">HubSpot Note Example</h3>
                  <p className="text-xs text-gray-500 mb-3">
                    Paste an example of a good HubSpot note for a {TYPE_LABELS[type].toLowerCase()}. Gemini will match this tone and format.
                  </p>
                  <RichEditor
                    initialHtml={t.note_example ?? ''}
                    editorRef={refs.note}
                    minHeight="min-h-[160px]"
                    placeholder={`Example HubSpot note for a ${TYPE_LABELS[type].toLowerCase()}…`}
                  />
                </section>

                {/* Follow-up Email */}
                <section className="bg-white rounded-xl border border-gray-200 p-6">
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">Follow-up Email Example</h3>
                  <p className="text-xs text-gray-500 mb-3">
                    Paste an example follow-up email for a {TYPE_LABELS[type].toLowerCase()}. Gemini will match this tone and format.
                  </p>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
                      <input type="text"
                        value={subjects[type] ?? ''}
                        onChange={(e) => setSubjects((prev) => ({ ...prev, [type]: e.target.value }))}
                        placeholder="Example subject line…"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Body</label>
                      <RichEditor
                        initialHtml={t.email_body_example ?? ''}
                        editorRef={refs.emailBody}
                        minHeight="min-h-[220px]"
                        placeholder="Example email body…"
                      />
                    </div>
                  </div>
                </section>

                <div className="flex justify-end">
                  <button onClick={() => saveTemplate(type)} disabled={saving[type]}
                    className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {saving[type] ? 'Saving…' : saved[type] ? '✓ Saved' : 'Save'}
                  </button>
                </div>
              </div>
            )
          })()}

          {/* Approved links */}
          {activeTab === 'links' && (
            <div className="max-w-3xl pb-12 space-y-6">
              <section className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Approved Links</h3>
                <p className="text-xs text-gray-500 mb-4">
                  Gemini will only include these URLs in generated emails. If none are added, no links or placeholders will appear.
                </p>

                {links.length === 0 ? (
                  <p className="text-sm text-gray-400 italic mb-4">No approved links yet.</p>
                ) : (
                  <ul className="space-y-2 mb-4">
                    {links.map((link) => (
                      <li key={link.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800">{link.label}</p>
                          <p className="text-xs text-blue-600 truncate">{link.url}</p>
                        </div>
                        <button onClick={() => removeLink(link.id)}
                          className="ml-4 text-xs text-red-500 hover:text-red-700 transition-colors flex-shrink-0"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <p className="text-xs font-medium text-gray-500">Add a link</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Label</label>
                      <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="e.g. Account Activation"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">URL</label>
                      <input type="url" value={newUrl} onChange={(e) => setNewUrl(e.target.value)}
                        placeholder="https://…"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  {linkError && <p className="text-xs text-red-600">{linkError}</p>}
                  <div className="flex justify-end">
                    <button onClick={addLink} disabled={addingLink || !newUrl.trim() || !newLabel.trim()}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {addingLink ? 'Adding…' : 'Add Link'}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
