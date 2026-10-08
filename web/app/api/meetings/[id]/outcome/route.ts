import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isLeadership } from '@/lib/auth'
import { getMeetingById, updateMeetingOutcome } from '@/lib/db'

// HubSpot's hs_meeting_outcome values for a meeting that has taken (or not taken) place.
const OUTCOMES = ['COMPLETED', 'NO_SHOW', 'RESCHEDULED', 'CANCELED']

/**
 * Correct a meeting's outcome from the orb. The worker picks the change up on its
 * next poll: COMPLETED is (re)synthesized from the stored transcript, anything else
 * is settled as a no-show, and either way the nurture tool is told.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const outcome = String(body?.outcome ?? '').toUpperCase()
  if (!OUTCOMES.includes(outcome)) {
    return NextResponse.json({ error: `Invalid outcome. Must be one of: ${OUTCOMES.join(', ')}` }, { status: 400 })
  }

  const meeting = await getMeetingById(params.id)
  if (!meeting) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const email = session.user.email
  if (!isLeadership(email) && meeting.recording_owner !== email) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // The worker queue only holds meetings with a transcript, and COMPLETED means
  // synthesizing one — so there has to be something to work from.
  if (!meeting.transcript_text?.trim()) {
    return NextResponse.json(
      { error: outcome === 'COMPLETED'
          ? 'This meeting has no transcript, so there is nothing to analyze.'
          : 'This meeting has no transcript, so its outcome cannot be changed here.' },
      { status: 409 }
    )
  }

  await updateMeetingOutcome(params.id, outcome)
  return NextResponse.json({ id: params.id, meeting_outcome: outcome })
}
