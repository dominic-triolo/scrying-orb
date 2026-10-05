import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { recallConfigured } from '@/lib/recallCalendar'
import { hasActiveBot, parseExternalEmails, parseMeetUrl, sendBot } from '@/lib/recallBot'

export const dynamic = 'force-dynamic'

/**
 * Send the notetaker into a Google Meet right now, on behalf of the signed-in rep.
 * The manual fallback for calls it didn't join on its own. Any signed-in user may
 * use it; the meeting is recorded under their name.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email?.toLowerCase()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!recallConfigured()) {
    return NextResponse.json({ error: 'Notetaker not configured' }, { status: 503 })
  }

  const body = await req.json().catch(() => null)
  const meetingUrl = parseMeetUrl(String(body?.meeting_url ?? ''))
  if (!meetingUrl) {
    return NextResponse.json({ error: 'Paste a Google Meet link, like meet.google.com/abc-defg-hij.' }, { status: 400 })
  }
  const meetingName = String(body?.meeting_name ?? '').trim()
  if (!meetingName) {
    return NextResponse.json({ error: 'Give the meeting a title.' }, { status: 400 })
  }
  const externalAttendees = parseExternalEmails(String(body?.external_attendees ?? ''))
  if (externalAttendees === null) {
    return NextResponse.json({ error: 'Guest emails must be valid email addresses.' }, { status: 400 })
  }

  try {
    if (await hasActiveBot(meetingUrl)) {
      return NextResponse.json({ error: 'The notetaker is already in this meeting.' }, { status: 409 })
    }
    const botId = await sendBot({ meetingUrl, meetingName, owner: email, externalAttendees })
    return NextResponse.json({ ok: true, bot_id: botId })
  } catch (err) {
    console.error('Manual notetaker add failed', err)
    return NextResponse.json({ error: 'Could not reach the notetaker service. Try again.' }, { status: 502 })
  }
}
