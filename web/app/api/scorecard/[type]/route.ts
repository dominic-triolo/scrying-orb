import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getScorecard, upsertScorecard } from '@/lib/db'

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
  const scorecard = await getScorecard(params.type)
  return NextResponse.json(scorecard ?? null)
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

  const { min_score, mid_score, max_score, formatting_prompt, sections } = await req.json()

  if (!['intro', 'planning'].includes(params.type)) {
    return NextResponse.json({ error: 'Scorecards only supported for intro and planning meetings' }, { status: 400 })
  }

  await upsertScorecard(params.type, {
    min_score: Number(min_score) || 1,
    mid_score: Number(mid_score) || 3,
    max_score: Number(max_score) || 5,
    formatting_prompt: formatting_prompt ?? null,
    sections: (sections ?? []).map((s: Record<string, unknown>, i: number) => ({
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
}
