import { NextRequest, NextResponse } from 'next/server'
import { requireLeadership } from '@/lib/auth'
import { countAnalyzableTranscripts } from '@/lib/db'
import { parseFilters, estimateSeconds, WARN_THRESHOLD } from '@/lib/analysis'

// How many transcripts match these filters, and roughly how long the run takes —
// backs the submit → estimate → confirm step. Leadership-only.
export async function POST(req: NextRequest) {
  const email = await requireLeadership()
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const body = await req.json().catch(() => ({}))
    const filters = parseFilters(body)
    const count = await countAnalyzableTranscripts(filters)
    return NextResponse.json({
      count,
      estimatedSeconds: estimateSeconds(count),
      warn: count > WARN_THRESHOLD,
      warnThreshold: WARN_THRESHOLD,
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'error' },
      { status: 500 }
    )
  }
}
