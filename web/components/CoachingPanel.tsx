'use client'

import { useEffect, useState } from 'react'

interface SectionScore {
  section_id: string
  title: string
  score: number
  reasoning: string
}

interface Score {
  id: string
  meeting_id: string
  section_scores: SectionScore[]
  overall_score: number | null
  coaching_output: string | null
  max_score: number
  rep_talk_pct: number | null
  prospect_talk_pct: number | null
  created_at: string
}

interface CoachingPanelProps {
  meetingId: string
}

// ── Sub-components ─────────────────────────────────────────────────────────

function TalkRatioBar({ repPct, prospectPct }: { repPct: number | null; prospectPct: number | null }) {
  if (repPct == null || prospectPct == null) {
    return (
      <p className="text-sm text-gray-400 italic">Talk ratio not available.</p>
    )
  }
  const otherPct = Math.max(0, 100 - repPct - prospectPct)

  return (
    <div className="space-y-3">
      <div className="flex rounded-full overflow-hidden h-4">
        <div
          style={{ width: `${repPct}%` }}
          className="bg-blue-500 transition-all"
          title={`Rep: ${repPct}%`}
        />
        <div
          style={{ width: `${prospectPct}%` }}
          className="bg-emerald-500 transition-all"
          title={`Prospect: ${prospectPct}%`}
        />
        {otherPct > 0 && (
          <div
            style={{ width: `${otherPct}%` }}
            className="bg-gray-200 transition-all"
            title={`Other: ${otherPct}%`}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full bg-blue-500" />
          <span className="text-gray-700">Rep</span>
          <span className="font-semibold text-gray-900">{repPct}%</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full bg-emerald-500" />
          <span className="text-gray-700">Prospect</span>
          <span className="font-semibold text-gray-900">{prospectPct}%</span>
        </span>
        {otherPct > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-gray-300" />
            <span className="text-gray-700">Other</span>
            <span className="font-semibold text-gray-900">{otherPct}%</span>
          </span>
        )}
      </div>
    </div>
  )
}

function ScoreBadge({ score, maxScore, size = 'sm' }: { score: number; maxScore: number; size?: 'sm' | 'lg' }) {
  const s = Number(score)
  const mx = Number(maxScore)
  const pct = mx > 0 ? s / mx : 0
  const color = pct >= 0.8 ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : pct >= 0.55 ? 'text-blue-700 bg-blue-50 border-blue-200'
    : 'text-amber-700 bg-amber-50 border-amber-200'

  if (size === 'lg') {
    return (
      <div className={`inline-flex flex-col items-center rounded-2xl border-2 px-6 py-3 ${color}`}>
        <span className="text-4xl font-bold leading-none">{s.toFixed(1)}</span>
        <span className="text-sm mt-1 opacity-70">/ {mx}</span>
      </div>
    )
  }
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-sm font-semibold ${color}`}>
      {s.toFixed(1)} / {mx}
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function CoachingPanel({ meetingId }: CoachingPanelProps) {
  const [score, setScore] = useState<Score | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)

      /** Safe JSON parse — returns null if body is not JSON */
      async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
        try { return await res.json() } catch { return null }
      }

      try {
        // Try GET first
        const getRes = await fetch(`/api/meetings/${meetingId}/score`)
        if (getRes.ok) {
          setScore(await getRes.json())
          return
        }

        if (getRes.status !== 404) {
          const data = await safeJson(getRes)
          setError((data?.error as string) ?? `Server error ${getRes.status}`)
          return
        }

        // No score yet — auto-generate
        setGenerating(true)
        const postRes = await fetch(`/api/meetings/${meetingId}/score`, { method: 'POST' })
        if (postRes.ok) {
          setScore(await postRes.json())
        } else {
          const data = await safeJson(postRes)
          setError((data?.error as string) ?? `Server error ${postRes.status}`)
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Unexpected error loading coaching data')
      } finally {
        setGenerating(false)
        setLoading(false)
      }
    }

    load()
  }, [meetingId])

  async function regenerate() {
    setGenerating(true); setError(null)
    const res = await fetch(`/api/meetings/${meetingId}/score`, { method: 'POST' })
    if (res.ok) {
      setScore(await res.json())
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to regenerate score')
    }
    setGenerating(false)
  }

  if (loading || generating) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <div className="flex items-center justify-center gap-3 text-sm text-gray-500">
            <svg className="h-4 w-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            {loading ? 'Loading…' : 'Analyzing transcript and scoring the call — this may take a moment…'}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-amber-50 rounded-xl border border-amber-200 p-6">
        <p className="text-sm font-medium text-amber-800 mb-1">Could not generate coaching</p>
        <p className="text-sm text-amber-700">{error}</p>
      </div>
    )
  }

  if (!score) return null

  return (
    <div className="space-y-6 max-w-3xl">

      {/* Overall score + talk ratio */}
      <div className="grid grid-cols-2 gap-4">

        {/* Overall score */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Overall Score</h3>
          <div className="flex items-center gap-4">
            {score.overall_score != null && (
              <ScoreBadge score={score.overall_score} maxScore={score.max_score} size="lg" />
            )}
            <div className="text-xs text-gray-400 leading-relaxed">
              Weighted average<br />across all rubric<br />sections
            </div>
          </div>
        </section>

        {/* Talk ratio */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Talk Ratio</h3>
          <TalkRatioBar repPct={score.rep_talk_pct} prospectPct={score.prospect_talk_pct} />
        </section>
      </div>

      {/* Section scores */}
      {score.section_scores.length > 0 && (
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Section Scores</h3>
          <div className="space-y-4">
            {score.section_scores.map((ss) => (
              <div key={ss.section_id} className="flex items-start gap-4 pb-4 border-b border-gray-100 last:border-0 last:pb-0">
                <div className="flex-shrink-0 pt-0.5">
                  <ScoreBadge score={ss.score} maxScore={score.max_score} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 mb-0.5">{ss.title}</p>
                  <p className="text-sm text-gray-500">{ss.reasoning}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Coaching output */}
      {score.coaching_output && (
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Coaching Feedback</h3>
          <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-line leading-relaxed">
            {score.coaching_output}
          </div>
        </section>
      )}

      {/* Footer: scored date + regenerate */}
      <div className="flex items-center justify-between text-xs text-gray-400 pb-4">
        <span>Scored {new Date(score.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        <button onClick={regenerate} disabled={generating}
          className="text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
        >
          {generating ? 'Regenerating…' : 'Regenerate Score'}
        </button>
      </div>

    </div>
  )
}
