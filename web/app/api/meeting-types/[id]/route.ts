import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMeetingTypes, upsertMeetingType, deleteMeetingType } from '@/lib/db'

function isAdmin(email: string): boolean {
  const list = (process.env.LEADERSHIP_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase())
  return list.includes(email.toLowerCase())
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || !isAdmin(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const body = await req.json()
    const { label, scoreable, sort_order } = body
    if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 })
    await upsertMeetingType({ id: params.id, label, scoreable: !!scoreable, sort_order: sort_order ?? 0 })
    const types = await getMeetingTypes()
    return NextResponse.json(types)
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'DB error' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || !isAdmin(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    await deleteMeetingType(params.id)
    const types = await getMeetingTypes()
    return NextResponse.json(types)
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'DB error' }, { status: 500 })
  }
}
