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

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Gemini not configured' }, { status: 503 })
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

  const prompt = `You are a helpful assistant answering questions about a sales call transcript. Be concise and specific — answer only what was asked. If the answer isn't clearly present in the transcript, say so.

Meeting: ${meeting.meeting_name}

TRANSCRIPT:
${meeting.transcript_text}

Question: ${question}`

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  )

  if (!geminiRes.ok) {
    const err = await geminiRes.text()
    console.error('Gemini ask failed:', err)
    return NextResponse.json({ error: `Gemini error: ${geminiRes.status} — ${err}` }, { status: 502 })
  }

  const data = await geminiRes.json()
  const answer = data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No answer returned.'

  return NextResponse.json({ answer })
}
