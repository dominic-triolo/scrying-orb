import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isLeadership } from '@/lib/auth'
import { getMeetings } from '@/lib/db'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const email = session.user.email
  const leader = isLeadership(email)
  const { searchParams } = new URL(req.url)

  // Non-leadership are always scoped to their own meetings; leadership see everyone
  // unless they toggle "my meetings" (mine=1).
  const mine = searchParams.get('mine') === '1'
  const repEmail = leader ? (mine ? email : undefined) : email

  const num = (v: string | null) => (v && !Number.isNaN(Number(v)) ? Number(v) : undefined)

  const page = await getMeetings({
    repEmail,
    q: searchParams.get('q') ?? undefined,
    type: searchParams.get('type') ?? undefined,
    dateFrom: searchParams.get('from') ?? undefined,
    dateTo: searchParams.get('to') ?? undefined,
    limit: num(searchParams.get('limit')),
    offset: num(searchParams.get('offset')),
  })
  return NextResponse.json(page)
}
