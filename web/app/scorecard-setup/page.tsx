'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const SCOREABLE_TYPES = ['intro', 'planning'] as const
type ScoreableType = typeof SCOREABLE_TYPES[number]

const TYPE_LABELS: Record<ScoreableType, string> = {
  intro:    'Intro Call',
  planning: 'Planning Call',
}

interface SectionState {
  id?: string
  title: string
  description_min: string
  description_mid: string
  description_max: string
  weight: string
}

interface ScorecardState {
  min_score: string
  mid_score: string
  max_score: string
  formatting_prompt: string
  sections: SectionState[]
}

const defaultState = (): ScorecardState => ({
  min_score: '1',
  mid_score: '3',
  max_score: '5',
  formatting_prompt: '',
  sections: [],
})

function emptySection(): SectionState {
  return { title: '', description_min: '', description_mid: '', description_max: '', weight: '' }
}

export default function ScorecardSetupPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<ScoreableType>('intro')
  const [state, setState] = useState<Record<ScoreableType, ScorecardState>>({
    intro: defaultState(),
    planning: defaultState(),
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Gate: check leadership
    fetch('/api/me')
      .then((r) => r.json())
      .then((data) => {
        if (!data.isLeadership) { router.replace('/'); return }
        return fetch('/api/scorecard').then((r) => r.json())
      })
      .then((scorecards: unknown) => {
        if (!Array.isArray(scorecards)) return
        const next = { intro: defaultState(), planning: defaultState() }
        for (const sc of scorecards) {
          const type = sc.meeting_type as ScoreableType
          if (!SCOREABLE_TYPES.includes(type)) continue
          next[type] = {
            min_score: String(sc.min_score ?? 1),
            mid_score: String(sc.mid_score ?? 3),
            max_score: String(sc.max_score ?? 5),
            formatting_prompt: sc.formatting_prompt ?? '',
            sections: (sc.sections ?? []).map((s: Record<string, unknown>) => ({
              id: String(s.id),
              title: String(s.title ?? ''),
              description_min: String(s.description_min ?? ''),
              description_mid: String(s.description_mid ?? ''),
              description_max: String(s.description_max ?? ''),
              weight: s.weight != null ? String(s.weight) : '',
            })),
          }
        }
        setState(next)
      })
      .finally(() => setLoading(false))
  }, [router])

  function updateField(field: keyof Omit<ScorecardState, 'sections'>, value: string) {
    setState((prev) => ({
      ...prev,
      [activeTab]: { ...prev[activeTab], [field]: value },
    }))
    setSaved(false)
  }

  function updateSection(index: number, field: keyof SectionState, value: string) {
    setState((prev) => {
      const sections = [...prev[activeTab].sections]
      sections[index] = { ...sections[index], [field]: value }
      return { ...prev, [activeTab]: { ...prev[activeTab], sections } }
    })
    setSaved(false)
  }

  function addSection() {
    setState((prev) => ({
      ...prev,
      [activeTab]: {
        ...prev[activeTab],
        sections: [...prev[activeTab].sections, emptySection()],
      },
    }))
  }

  function removeSection(index: number) {
    setState((prev) => {
      const sections = prev[activeTab].sections.filter((_, i) => i !== index)
      return { ...prev, [activeTab]: { ...prev[activeTab], sections } }
    })
    setSaved(false)
  }

  function moveSection(index: number, dir: -1 | 1) {
    setState((prev) => {
      const sections = [...prev[activeTab].sections]
      const target = index + dir
      if (target < 0 || target >= sections.length) return prev;
      [sections[index], sections[target]] = [sections[target], sections[index]]
      return { ...prev, [activeTab]: { ...prev[activeTab], sections } }
    })
    setSaved(false)
  }

  async function save() {
    setSaving(true); setError(null)
    const sc = state[activeTab]
    try {
      const res = await fetch(`/api/scorecard/${activeTab}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          min_score: Number(sc.min_score) || 1,
          mid_score: Number(sc.mid_score) || 3,
          max_score: Number(sc.max_score) || 5,
          formatting_prompt: sc.formatting_prompt || null,
          sections: sc.sections
            .filter((s) => s.title.trim())
            .map((s, i) => ({
              id: s.id,
              title: s.title,
              description_min: s.description_min || null,
              description_mid: s.description_mid || null,
              description_max: s.description_max || null,
              weight: s.weight !== '' ? Number(s.weight) : null,
              sort_order: i,
            })),
        }),
      })
      const text = await res.text()
      let data: Record<string, unknown> = {}
      try { data = JSON.parse(text) } catch { /* non-JSON response */ }
      if (!res.ok) throw new Error((data.error as string) ?? `Server error ${res.status} — check that migration 004_scoring.sql has been run`)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  const sc = state[activeTab]

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
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Templates
          </Link>
          <Link href="/scorecard-setup"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium bg-slate-800 text-white transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            Scorecard Setup
          </Link>
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-gray-50">
        <div className="bg-white border-b border-gray-200 px-8 py-6">
          <h1 className="text-xl font-bold text-gray-900">Scorecard Setup</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure scoring rubrics for each meeting type. Gemini will evaluate transcripts against these criteria and generate coaching feedback.
          </p>
        </div>

        <div className="px-8 pt-6">
          {/* Tabs */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="flex gap-6">
              {SCOREABLE_TYPES.map((type) => (
                <button key={type} onClick={() => setActiveTab(type)}
                  className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === type ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {TYPE_LABELS[type]}
                </button>
              ))}
            </nav>
          </div>

          <div className="max-w-3xl space-y-6 pb-12">

            {/* Score range */}
            <section className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Score Range</h3>
              <p className="text-xs text-gray-500 mb-4">
                Define the minimum, midpoint, and maximum scores. Gemini can assign any value between min and max.
              </p>
              <div className="grid grid-cols-3 gap-4">
                {(['min_score', 'mid_score', 'max_score'] as const).map((field) => (
                  <div key={field}>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      {field === 'min_score' ? 'Minimum' : field === 'mid_score' ? 'Midpoint' : 'Maximum'}
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={sc[field]}
                      onChange={(e) => updateField(field, e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                ))}
              </div>
            </section>

            {/* Formatting prompt */}
            <section className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Coaching Output Format</h3>
              <p className="text-xs text-gray-500 mb-3">
                Describe how the written coaching feedback should be structured. Gemini will follow these instructions when writing the coaching output.
              </p>
              <textarea
                value={sc.formatting_prompt}
                onChange={(e) => updateField('formatting_prompt', e.target.value)}
                rows={4}
                placeholder="e.g. Start with a 1-sentence summary of overall performance. Then provide a paragraph of specific strengths, followed by a paragraph of areas for improvement. End with 2-3 actionable coaching points."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </section>

            {/* Rubric sections */}
            <section className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-gray-900">Rubric Sections</h3>
                <span className="text-xs text-gray-400">{sc.sections.length} section{sc.sections.length !== 1 ? 's' : ''}</span>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                Each section is scored independently. Descriptions tell Gemini what each score level looks like. Weight controls how much each section contributes to the overall score (leave blank for equal weight).
              </p>

              {sc.sections.length === 0 && (
                <p className="text-sm text-gray-400 italic mb-4">No rubric sections yet. Add one below.</p>
              )}

              <div className="space-y-5">
                {sc.sections.map((section, i) => (
                  <div key={i} className="rounded-lg border border-gray-200 p-5 bg-gray-50">
                    {/* Section header */}
                    <div className="flex items-start gap-3 mb-4">
                      <div className="flex-1 grid grid-cols-[1fr_auto] gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Section Title</label>
                          <input
                            type="text"
                            value={section.title}
                            onChange={(e) => updateSection(i, 'title', e.target.value)}
                            placeholder="e.g. Objection Handling"
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div className="w-24">
                          <label className="block text-xs font-medium text-gray-500 mb-1">Weight</label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={section.weight}
                            onChange={(e) => updateSection(i, 'weight', e.target.value)}
                            placeholder="Auto"
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                      {/* Controls */}
                      <div className="flex flex-col gap-1 mt-5">
                        <button onClick={() => moveSection(i, -1)} disabled={i === 0}
                          className="p-1 rounded text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                          title="Move up"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button onClick={() => moveSection(i, 1)} disabled={i === sc.sections.length - 1}
                          className="p-1 rounded text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                          title="Move down"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <button onClick={() => removeSection(i)}
                          className="p-1 rounded text-red-400 hover:text-red-600 transition-colors"
                          title="Remove section"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Score descriptions */}
                    <div className="space-y-3">
                      {(['description_min', 'description_mid', 'description_max'] as const).map((field) => {
                        const scoreVal = field === 'description_min' ? sc.min_score : field === 'description_mid' ? sc.mid_score : sc.max_score
                        const label = field === 'description_min' ? 'Minimum' : field === 'description_mid' ? 'Midpoint' : 'Maximum'
                        return (
                          <div key={field}>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Score {scoreVal} — {label}
                            </label>
                            <textarea
                              value={section[field]}
                              onChange={(e) => updateSection(i, field, e.target.value)}
                              rows={3}
                              placeholder={`Describe what a ${label.toLowerCase()} score looks like for ${section.title || 'this section'}…`}
                              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <button onClick={addSection}
                className="mt-4 flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Section
              </button>
            </section>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end">
              <button onClick={save} disabled={saving}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : saved ? '✓ Saved' : `Save ${TYPE_LABELS[activeTab]} Scorecard`}
              </button>
            </div>

          </div>
        </div>
      </main>
    </div>
  )
}
