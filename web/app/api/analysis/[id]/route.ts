import { NextResponse } from 'next/server'
import { requireLeadership } from '@/lib/auth'
import { getAnalysisJob, getAnalysisMessages } from '@/lib/db'

// Job status + progress + result + chat history. Polled by the results page.
// Leadership-only; any leader may view any analysis (shared insights).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const email = await requireLeadership()
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const job = await getAnalysisJob(params.id)
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const messages = await getAnalysisMessages(params.id)
    return NextResponse.json({ job, messages })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'DB error' },
      { status: 500 }
    )
  }
}
