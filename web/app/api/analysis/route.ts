import { NextRequest, NextResponse } from 'next/server'
import { requireLeadership } from '@/lib/auth'
import { countAnalyzableTranscripts, createAnalysisJob, listAnalysisJobs } from '@/lib/db'
import { parseFilters } from '@/lib/analysis'

// GET: recent analyses (history list). Leadership-only.
export async function GET() {
  const email = await requireLeadership()
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const jobs = await listAnalysisJobs()
    return NextResponse.json({ jobs })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'DB error' },
      { status: 500 }
    )
  }
}

// POST: create a queued analysis job. Re-counts server-side (the confirmed count
// is authoritative and equals what the worker will process). Leadership-only.
export async function POST(req: NextRequest) {
  const email = await requireLeadership()
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const body = await req.json().catch(() => ({}))
    const query = typeof body.query === 'string' ? body.query.trim() : ''
    if (!query) {
      return NextResponse.json({ error: 'A question is required' }, { status: 400 })
    }
    const filters = parseFilters(body)
    const total = await countAnalyzableTranscripts(filters)
    if (total === 0) {
      return NextResponse.json({ error: 'No transcripts match these filters' }, { status: 400 })
    }
    const id = await createAnalysisJob(email, query, filters, total)
    return NextResponse.json({ id, total })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'error' },
      { status: 500 }
    )
  }
}
