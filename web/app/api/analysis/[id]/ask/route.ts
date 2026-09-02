import { NextRequest, NextResponse } from 'next/server'
import { requireLeadership } from '@/lib/auth'
import {
  getAnalysisJob,
  getAnalysisMessages,
  getAnalysisFindingSample,
  addAnalysisMessage,
} from '@/lib/db'
import { callGemini } from '@/lib/gemini'

const SYSTEM =
  'You answer follow-up questions about a COMPLETED analysis of many sales-call ' +
  'transcripts. Ground every answer in the provided analysis result, aggregate ' +
  'stats, and sample findings. Use the exact numbers from the stats; never invent ' +
  'counts. If the provided data does not contain the answer, say so plainly. Be concise.'

// Chat follow-up over a completed analysis. Grounded in the stored result +
// a bounded sample of findings + the prior conversation. Leadership-only.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const email = await requireLeadership()
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question) {
    return NextResponse.json({ error: 'A question is required' }, { status: 400 })
  }

  const job = await getAnalysisJob(params.id)
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (job.status !== 'complete') {
    return NextResponse.json({ error: 'Analysis is not complete yet' }, { status: 400 })
  }

  const [messages, sample] = await Promise.all([
    getAnalysisMessages(params.id),
    getAnalysisFindingSample(params.id, 60),
  ])

  const history = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n')
  const prompt = `ORIGINAL QUESTION:
${job.query}

ANALYSIS RESULT (answer + aggregate stats):
${JSON.stringify(job.result, null, 2)}

SAMPLE PER-TRANSCRIPT FINDINGS (${sample.length}):
${JSON.stringify(sample, null, 2)}

CONVERSATION SO FAR:
${history || '(none)'}

FOLLOW-UP QUESTION:
${question}`

  try {
    const answer = await callGemini(prompt, { systemInstruction: SYSTEM })
    await addAnalysisMessage(params.id, 'user', question)
    await addAnalysisMessage(params.id, 'assistant', answer)
    return NextResponse.json({ answer })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gemini error' },
      { status: 502 }
    )
  }
}
