import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMeetingById } from '@/lib/db'

export async function POST(
  _req: NextRequest,
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

  const meeting = await getMeetingById(params.id)
  if (!meeting) {
    return NextResponse.json({ error: 'Meeting not found' }, { status: 404 })
  }

  const synthesis = meeting.synthesis_output
  if (!synthesis) {
    return NextResponse.json(
      { error: 'Meeting synthesis not yet available — try again shortly' },
      { status: 400 }
    )
  }

  const repFirstName = (meeting.recording_owner ?? '').split('@')[0]
  const prospectEmails = meeting.contacts.map((c) => c.email).join(', ')
  const nextSteps = Array.isArray(synthesis.next_steps)
    ? (synthesis.next_steps as string[]).join('; ')
    : (synthesis.next_steps as string) ?? ''

  const prompt = `You are drafting a brief, warm follow-up email from a TrovaTrip sales rep to a prospect after a call.

Rep: ${repFirstName}
Prospect email(s): ${prospectEmails}
Meeting: ${meeting.meeting_name}

Summary of the call: ${synthesis.summary ?? ''}
Agreed next steps: ${nextSteps}

Write a concise, genuine follow-up email — not a template, not overly formal. 2-3 short paragraphs max.
Return a JSON object with exactly two string fields: "subject" and "body" (plain text, no markdown).`

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    }
  )

  if (!geminiRes.ok) {
    const err = await geminiRes.text()
    console.error('Gemini draft failed:', err)
    return NextResponse.json({ error: `Gemini error: ${geminiRes.status} — ${err}` }, { status: 502 })
  }

  const data = await geminiRes.json()
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'

  let draft: { subject: string; body: string }
  try {
    draft = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Could not parse email draft from Gemini' }, { status: 500 })
  }

  return NextResponse.json({
    to: prospectEmails,
    subject: draft.subject ?? '',
    body: draft.body ?? '',
  })
}
