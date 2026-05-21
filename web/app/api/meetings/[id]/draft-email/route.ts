import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMeetingById } from '@/lib/db'
import { callGemini } from '@/lib/gemini'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  try {
    const raw = await callGemini(prompt, { jsonMode: true })
    let draft: { subject: string; body: string }
    try {
      draft = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Could not parse email draft from Gemini' }, { status: 500 })
    }
    return NextResponse.json({ to: prospectEmails, subject: draft.subject ?? '', body: draft.body ?? '' })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('Gemini draft failed:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
