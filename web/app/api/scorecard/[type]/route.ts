import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getScorecard, upsertScorecard, getMeetingTypes } from '@/lib/db'

function isLeadership(email: string): boolean {
  const emails = (process.env.LEADERSHIP_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return emails.includes(email.toLowerCase())
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { type: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const scorecard = await getScorecard(params.type)
    return NextResponse.json(scorecard ?? null)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Database error'
    console.error('GET scorecard error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { type: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isLeadership(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const allTypes = await getMeetingTypes()
  const typeConfig = allTypes.find((t) => t.id === params.type)
  if (!typeConfig?.scoreable) {
    return NextResponse.json({ error: 'Scorecards are only supported for scoreable meeting types' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { min_score, mid_score, max_score, formatting_prompt, sections } = body

  try {
    await upsertScorecard(params.type, {
      min_score: Number(min_score) || 1,
      mid_score: Number(mid_score) || 3,
      max_score: Number(max_score) || 5,
      formatting_prompt: formatting_prompt ? String(formatting_prompt) : null,
      sections: (Array.isArray(sections) ? sections : []).map((s: Record<string, unknown>, i: number) => ({
        title: String(s.title ?? ''),
        description_min: s.description_min ? String(s.description_min) : null,
        description_mid: s.description_mid ? String(s.description_mid) : null,
        description_max: s.description_max ? String(s.description_max) : null,
        weight: s.weight !== '' && s.weight != null ? Number(s.weight) : null,
        sort_order: i,
      })),
    })

    const updated = await getScorecard(params.type)
    return NextResponse.json(updated)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Database error'
    console.error('PUT scorecard error:', msg)
    // Surface a helpful message if the migration hasn't been run
    const hint = msg.includes('relation') || msg.includes('does not exist')
      ? ' — make sure you have run migration 004_scoring.sql in your database'
      : ''
    return NextResponse.json({ error: msg + hint }, { status: 500 })
  }
}
