import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMeetingById, getTemplate } from '@/lib/db'
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

  const meetingType = meeting.meeting_type ?? 'nurture'
  const template = await getTemplate(meetingType)

  const nextSteps = Array.isArray(synthesis.next_steps)
    ? (synthesis.next_steps as string[]).join('\n- ')
    : (synthesis.next_steps as string) ?? ''

  const actionItems = Array.isArray(synthesis.action_items)
    ? (synthesis.action_items as string[]).join('\n- ')
    : ''

  // Build template guidance
  let templateSection = ''
  if (template?.note_example) {
    templateSection = `\n\nEXAMPLE NOTE TO MATCH (tone, style, and format — do not copy verbatim):\n${template.note_example}`
  }

  const prompt = `You are writing a concise internal HubSpot CRM note for a TrovaTrip sales rep after a ${meetingType} call.

Meeting: ${meeting.meeting_name}
Meeting type: ${meetingType}

Summary: ${synthesis.summary ?? ''}
${nextSteps ? `\nNext steps:\n- ${nextSteps}` : ''}
${actionItems ? `\nAction items:\n- ${actionItems}` : ''}
${templateSection}

Write a brief, factual CRM note summarizing the call outcome and next steps. Plain text only — no markdown formatting, no bullet symbols, no headers. Keep it to 3-5 sentences.
Return a JSON object with a single string field: "note".`

  try {
    const raw = await callGemini(prompt, { jsonMode: true })
    let result: { note: string }
    try {
      result = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Could not parse note from Gemini' }, { status: 500 })
    }
    return NextResponse.json({ note: result.note ?? '' })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('Gemini note generation failed:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
