import { NextResponse } from 'next/server'
import { requireLeadership } from '@/lib/auth'
import { listAnalysisReps } from '@/lib/db'

// Distinct reps (recording_owner) with at least one analyzable transcript —
// powers the rep multi-select on the analysis form. Leadership-only.
export async function GET() {
  const email = await requireLeadership()
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const reps = await listAnalysisReps()
    return NextResponse.json({ reps })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'DB error' },
      { status: 500 }
    )
  }
}
