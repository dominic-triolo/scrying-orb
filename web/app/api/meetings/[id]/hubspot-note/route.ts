import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMeetingById } from '@/lib/db'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.HUBSPOT_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'HubSpot not configured' }, { status: 503 })
  }

  const meeting = await getMeetingById(params.id)
  if (!meeting) {
    return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })
  }

  if (!meeting.hubspot_deal_id) {
    return NextResponse.json(
      { error: 'No HubSpot deal linked to this meeting' },
      { status: 400 }
    )
  }

  const { body } = await req.json()
  if (!body?.trim()) {
    return NextResponse.json({ error: 'Note body is required' }, { status: 400 })
  }

  // Use the Engagements v1 API — broader scope support than CRM v3 notes
  const noteRes = await fetch('https://api.hubapi.com/engagements/v1/engagements', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      engagement: {
        active: true,
        type: 'NOTE',
        timestamp: Date.now(),
      },
      associations: {
        dealIds: [meeting.hubspot_deal_id],
      },
      metadata: {
        body,
      },
    }),
  })

  if (!noteRes.ok) {
    const err = await noteRes.text()
    console.error('HubSpot note creation failed:', err)
    return NextResponse.json({ error: 'Failed to create HubSpot note' }, { status: 502 })
  }

  const note = await noteRes.json()
  return NextResponse.json({ noteId: note.engagement?.id })
}
