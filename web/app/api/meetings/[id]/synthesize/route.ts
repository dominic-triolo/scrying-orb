import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isLeadership } from '@/lib/auth'
import { getMeetingById, completeSynthesis } from '@/lib/db'
import { runSynthesis } from '@/lib/synthesis'

/**
 * On-demand synthesis for a legacy / imported meeting.
 *
 * Reps browse imported attention.io meetings (status='legacy') without any AI
 * analysis running; this fires it only when they click "Analyze". Runs synthesis
 * synchronously in the web process using the stored transcript, writes the result
 * back, and flips the meeting to 'complete'. Never emits to the nurture tool —
 * historical meetings stay out of that pipeline.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const meeting = await getMeetingById(params.id)
  if (!meeting) {
    return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })
  }
  if (!isLeadership(email) && meeting.recording_owner !== email) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!meeting.transcript_text) {
    return NextResponse.json(
      { error: 'No transcript stored for this meeting — nothing to analyze' },
      { status: 400 }
    )
  }

  const meetingType = meeting.meeting_type ?? 'nurture'
  try {
    const synthesis = await runSynthesis(meeting.transcript_text, meetingType)
    await completeSynthesis(params.id, synthesis)
    return NextResponse.json({ synthesis, status: 'complete' })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('On-demand synthesis failed:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
