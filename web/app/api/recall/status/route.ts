import { NextResponse } from 'next/server'
import { requireLeadership } from '@/lib/auth'
import { getNotetakerStatus } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Connected calendars and recent notetaker calls, with any failures — powers
// /settings/notetaker. Leadership-only.
export async function GET() {
  const email = await requireLeadership()
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    return NextResponse.json(await getNotetakerStatus())
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'DB error' },
      { status: 500 }
    )
  }
}
