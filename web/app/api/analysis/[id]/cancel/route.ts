import { NextResponse } from 'next/server'
import { requireLeadership } from '@/lib/auth'
import { cancelAnalysisJob } from '@/lib/db'

// Request cancellation. Flips a queued/running job to 'canceled'; the worker
// checks between map batches and stops. Leadership-only.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const email = await requireLeadership()
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const ok = await cancelAnalysisJob(params.id)
    return NextResponse.json({ ok })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'DB error' },
      { status: 500 }
    )
  }
}
