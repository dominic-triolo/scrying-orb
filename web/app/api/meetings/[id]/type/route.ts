import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isLeadership } from '@/lib/auth'
import { getMeetingById, updateMeetingType } from '@/lib/db'

const VALID_TYPES = ['intro', 'planning', 'nurture']

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { type } = await req.json()
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 })
  }

  const meeting = await getMeetingById(params.id)
  if (!meeting) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const email = session.user.email
  if (!isLeadership(email) && meeting.recording_owner !== email) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await updateMeetingType(params.id, type)

  // Return the updated meeting type so the UI can reflect it immediately
  return NextResponse.json({ id: params.id, meeting_type: type, meeting_type_source: 'manual' })
}
