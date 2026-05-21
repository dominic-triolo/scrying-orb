import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMeetingById } from '@/lib/db'
import { callGemini } from '@/lib/gemini'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { question } = await req.json()
  if (!question?.trim()) {
    return NextResponse.json({ error: 'Question is required' }, { status: 400 })
  }

  const meeting = await getMeetingById(params.id)
  if (!meeting) {
    return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })
  }

  if (!meeting.transcript_text) {
    return NextResponse.json(
      { error: 'No transcript available for this meeting' },
      { status: 400 }
    )
  }

  const prompt = `Meeting: ${meeting.meeting_name}

TRANSCRIPT:
${meeting.transcript_text}

Question: ${question}`

  try {
    const answer = await callGemini(prompt, {
      systemInstruction:
        'You are a helpful assistant answering questions about a sales call transcript. Be concise and specific — answer only what was asked. If the answer is not clearly present in the transcript, say so.',
    })
    return NextResponse.json({ answer })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('Gemini ask failed:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
