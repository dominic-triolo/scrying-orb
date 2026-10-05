import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRecallCalendar, removeRecallCalendar } from '@/lib/db'
import { deleteRecallCalendar, recallConfigured } from '@/lib/recallCalendar'

export const dynamic = 'force-dynamic'

/** The signed-in user's notetaker calendar connection, for the sidebar. */
export async function GET() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!recallConfigured()) return NextResponse.json({ configured: false, connected: false })
  const calendar = await getRecallCalendar(email)
  return NextResponse.json({
    configured: true,
    connected: calendar?.status === 'connected',
    status: calendar?.status ?? null,
  })
}

/** Disconnect: delete the calendar in Recall (which unschedules its bots), then our row. */
export async function DELETE() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const calendar = await getRecallCalendar(email)
  if (calendar) {
    await deleteRecallCalendar(calendar.recall_calendar_id)
    await removeRecallCalendar(email)
  }
  return NextResponse.json({ ok: true })
}
