import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMeetingTypes, upsertMeetingType } from '@/lib/db'

function isAdmin(email: string): boolean {
  const list = (process.env.LEADERSHIP_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase())
  return list.includes(email.toLowerCase())
}

export async function GET() {
  try {
    const types = await getMeetingTypes()
    return NextResponse.json(types)
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'DB error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || !isAdmin(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const body = await req.json()
    const { id, label, scoreable, sort_order } = body
    if (!id || !label) {
      return NextResponse.json({ error: 'id and label are required' }, { status: 400 })
    }
    if (!/^[a-z0-9_-]+$/.test(id)) {
      return NextResponse.json({ error: 'id must be lowercase letters, numbers, hyphens or underscores only' }, { status: 400 })
    }
    await upsertMeetingType({ id, label, scoreable: !!scoreable, sort_order: sort_order ?? 0 })
    const types = await getMeetingTypes()
    return NextResponse.json(types)
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'DB error' }, { status: 500 })
  }
}
