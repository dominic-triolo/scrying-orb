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

  const { body, dealIds } = await req.json()
  if (!body?.trim()) {
    return NextResponse.json({ error: 'Note body is required' }, { status: 400 })
  }
  if (!Array.isArray(dealIds) || dealIds.length === 0) {
    return NextResponse.json({ error: 'At least one deal must be selected' }, { status: 400 })
  }

  // Post a note to each selected deal via the Engagements v1 API
  const results: { dealId: string; noteId: string | null; error: string | null }[] = []

  for (const dealId of dealIds) {
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
          dealIds: [dealId],
        },
        metadata: { body },
      }),
    })

    if (!noteRes.ok) {
      const err = await noteRes.text()
      console.error(`HubSpot note failed for deal ${dealId}:`, err)
      results.push({ dealId, noteId: null, error: 'Failed to post note' })
    } else {
      const note = await noteRes.json()
      results.push({ dealId, noteId: note.engagement?.id ?? null, error: null })
    }
  }

  const allFailed = results.every((r) => r.error)
  if (allFailed) {
    return NextResponse.json({ error: 'Failed to post note to any deal' }, { status: 502 })
  }

  return NextResponse.json({ results })
}
