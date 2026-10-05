import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isLeadership } from '@/lib/auth'
import { getMeetingRecording } from '@/lib/db'
import { mediaConfigured, signedRecordingUrl } from '@/lib/media'

export const dynamic = 'force-dynamic'

/**
 * Redirect to a short-lived signed link for the meeting's recording. Used directly
 * as the <video> src: the browser re-requests this route for every seek, so a link
 * never has to outlive its TTL.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const meeting = await getMeetingRecording(params.id)
  if (!meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Same rule as the meeting itself: reps can only access their own.
  if (!isLeadership(email) && meeting.recording_owner !== email) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!meeting.recording_key || !mediaConfigured()) {
    return NextResponse.json({ error: 'No recording' }, { status: 404 })
  }
  return NextResponse.redirect(await signedRecordingUrl(meeting.recording_key))
}
