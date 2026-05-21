import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMeetingById, getScorecard, getMeetingScore, saveMeetingScore } from '@/lib/db'
import type { ScorecardSection, SectionScore } from '@/lib/db'
import { callGemini } from '@/lib/gemini'

// ── Talk ratio helpers ────────────────────────────────────────────────────────

/** Count words per speaker from a speaker-labeled Google Meet transcript */
function computeWordCounts(transcript: string): Record<string, number> {
  const counts: Record<string, number> = {}
  const lines = transcript.split('\n')
  let currentSpeaker: string | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) { currentSpeaker = null; continue }

    // "Speaker Name: text they said"
    const colonMatch = trimmed.match(/^([A-Z][^:]{1,50}):\s+(.+)/)
    if (colonMatch) {
      currentSpeaker = colonMatch[1].trim()
      const words = colonMatch[2].trim().split(/\s+/).filter(Boolean).length
      counts[currentSpeaker] = (counts[currentSpeaker] ?? 0) + words
      continue
    }

    // Standalone name line (Title Case, short — Google Meet format)
    const nameMatch = trimmed.match(/^[A-Z][a-zA-ZÀ-ÿ'-]+(?: [A-Z][a-zA-ZÀ-ÿ'-]+){0,4}$/)
    if (nameMatch && trimmed.length < 60 && !/[.!?,]$/.test(trimmed)) {
      currentSpeaker = trimmed
      if (!(currentSpeaker in counts)) counts[currentSpeaker] = 0
      continue
    }

    // Regular text — attribute to current speaker
    if (currentSpeaker) {
      const words = trimmed.split(/\s+/).filter(Boolean).length
      counts[currentSpeaker] = (counts[currentSpeaker] ?? 0) + words
    }
  }

  return counts
}

/** Compute weighted average score from section scores */
function computeWeightedScore(
  sectionScores: SectionScore[],
  sections: ScorecardSection[]
): number {
  const weightMap = new Map(sections.map((s) => [s.id, s.weight ?? 1]))
  let totalWeight = 0
  let weightedSum = 0

  for (const ss of sectionScores) {
    const weight = weightMap.get(ss.section_id) ?? 1
    totalWeight += weight
    weightedSum += ss.score * weight
  }

  if (totalWeight === 0) return 0
  return Math.round((weightedSum / totalWeight) * 10) / 10
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const meeting = await getMeetingById(params.id)
  if (!meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const score = await getMeetingScore(params.id)
  if (!score) return NextResponse.json({ error: 'No score yet' }, { status: 404 })

  // Augment with talk ratio from meetings table
  return NextResponse.json({
    ...score,
    rep_talk_pct: meeting.rep_talk_pct,
    prospect_talk_pct: meeting.prospect_talk_pct,
  })
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const meeting = await getMeetingById(params.id)
  if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })

  if (!meeting.transcript_text) {
    return NextResponse.json({ error: 'Transcript not available — cannot score without a transcript' }, { status: 400 })
  }

  const meetingType = meeting.meeting_type ?? ''
  if (!['intro', 'planning'].includes(meetingType)) {
    return NextResponse.json({ error: 'Scoring is only available for intro and planning meetings' }, { status: 400 })
  }

  const scorecard = await getScorecard(meetingType)
  if (!scorecard || scorecard.sections.length === 0) {
    return NextResponse.json({ error: 'No scorecard configured for this meeting type — set one up in Scorecard Setup' }, { status: 400 })
  }

  // Compute per-speaker word counts from transcript
  const wordCounts = computeWordCounts(meeting.transcript_text)
  const speakerList = Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}: ${count} words`)
    .join('\n')

  const repFirstName = (meeting.recording_owner ?? '').split('@')[0]
  const prospectEmails = meeting.contacts.map((c) => c.email).join(', ')

  const sectionsBlock = scorecard.sections.map((s) => `
[${s.title}]  section_id: ${s.id}${s.weight != null ? `  weight: ${s.weight}` : ''}
  Score ${scorecard.min_score}: ${s.description_min ?? '(no description)'}
  Score ${scorecard.mid_score}: ${s.description_mid ?? '(no description)'}
  Score ${scorecard.max_score}: ${s.description_max ?? '(no description)'}
`).join('\n')

  const prompt = `You are a sales coaching AI evaluating a ${meetingType} call.

Score each rubric section on the scale: ${scorecard.min_score} (minimum) to ${scorecard.max_score} (maximum).
${scorecard.mid_score} is the midpoint. You may assign any value between min and max (e.g. ${(scorecard.min_score + scorecard.mid_score) / 2}, ${(scorecard.mid_score + scorecard.max_score) / 2}).

=== RUBRIC SECTIONS ===
${sectionsBlock}

=== SPEAKER WORD COUNTS ===
${speakerList}

Rep (TrovaTrip employee, email: ${meeting.recording_owner ?? 'unknown'}): look for "${repFirstName}" or similar
Prospect contacts: ${prospectEmails || 'unknown'}

=== TRANSCRIPT ===
${meeting.transcript_text}

${scorecard.formatting_prompt ? `=== COACHING OUTPUT FORMAT ===\n${scorecard.formatting_prompt}\n` : ''}

Return a JSON object with exactly this shape:
{
  "section_scores": [
    {
      "section_id": "<exact section_id from rubric>",
      "title": "<section title>",
      "score": <numeric score between ${scorecard.min_score} and ${scorecard.max_score}>,
      "reasoning": "<1-2 sentences explaining the score>"
    }
  ],
  "coaching_output": "<written coaching feedback — comprehensive and actionable>",
  "rep_speaker_names": ["<name(s) as they appear in transcript for the TrovaTrip rep>"],
  "prospect_speaker_names": ["<name(s) as they appear in transcript for external participants>"]
}`

  let raw: string
  try {
    raw = await callGemini(prompt, { jsonMode: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('Gemini scoring failed:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  let parsed: {
    section_scores: Array<{ section_id: string; title: string; score: number; reasoning: string }>
    coaching_output: string
    rep_speaker_names: string[]
    prospect_speaker_names: string[]
  }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Could not parse scoring response from Gemini' }, { status: 500 })
  }

  // Compute talk ratio using Gemini-identified speakers
  let repPct: number | null = null
  let prospectPct: number | null = null

  const repNames = (parsed.rep_speaker_names ?? []).map((n) => n.toLowerCase())
  const prospectNames = (parsed.prospect_speaker_names ?? []).map((n) => n.toLowerCase())

  let repWords = 0
  let prospectWords = 0
  let totalWords = 0

  for (const [speaker, count] of Object.entries(wordCounts)) {
    totalWords += count
    const lc = speaker.toLowerCase()
    if (repNames.some((n) => lc.includes(n) || n.includes(lc))) {
      repWords += count
    } else if (prospectNames.some((n) => lc.includes(n) || n.includes(lc))) {
      prospectWords += count
    }
  }

  if (totalWords > 0) {
    repPct = Math.round((repWords / totalWords) * 100)
    prospectPct = Math.round((prospectWords / totalWords) * 100)
  }

  // Validate section scores — keep only sections that exist in scorecard
  const validIds = new Set(scorecard.sections.map((s) => s.id))
  const sectionScores: SectionScore[] = (parsed.section_scores ?? [])
    .filter((ss) => validIds.has(ss.section_id))
    .map((ss) => ({
      section_id: ss.section_id,
      title: ss.title,
      score: Math.min(scorecard.max_score, Math.max(scorecard.min_score, Number(ss.score))),
      reasoning: ss.reasoning ?? '',
    }))

  const overallScore = computeWeightedScore(sectionScores, scorecard.sections)

  const saved = await saveMeetingScore(params.id, {
    section_scores: sectionScores,
    overall_score: overallScore,
    coaching_output: parsed.coaching_output ?? '',
    max_score: scorecard.max_score,
    rep_talk_pct: repPct,
    prospect_talk_pct: prospectPct,
  })

  return NextResponse.json({
    ...saved,
    rep_talk_pct: repPct,
    prospect_talk_pct: prospectPct,
  })
}
