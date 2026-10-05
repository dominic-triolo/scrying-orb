import { NextResponse } from 'next/server'
import { enqueueRecallBot, requestRecallCalendarSync, setRecallCalendarStatus } from '@/lib/db'
import { getRecallCalendarStatus } from '@/lib/recallCalendar'
import { verifyRecallRequest } from '@/lib/recall'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Recall.ai status-change webhook. Not session-authenticated (excluded from the
 * next-auth middleware) — every request is verified against the workspace
 * verification secret instead.
 *
 *   transcript.done       → queue the bot for the synthesis worker
 *   transcript.failed     → record it as an error row so the miss is visible
 *   calendar.sync_events  → flag the calendar for the worker's calendar-sync thread
 *   calendar.update       → mirror the calendar's status (e.g. disconnected)
 *   anything else         → acknowledged and ignored
 */
export async function POST(req: Request) {
  const secret = process.env.RECALL_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Recall ingest not configured' }, { status: 503 })
  }

  // Signature is over the raw bytes — read text, never req.json().
  const rawBody = await req.text()
  if (!verifyRecallRequest(secret, req.headers, rawBody)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event: string = body?.event ?? ''
  const data = body?.data ?? {}

  if (event === 'calendar.sync_events') {
    if (!data.calendar_id || !data.last_updated_ts) {
      return NextResponse.json({ ok: true, ignored: 'incomplete' })
    }
    const known = await requestRecallCalendarSync(data.calendar_id, data.last_updated_ts)
    return NextResponse.json({ ok: true, known })
  }

  if (event === 'calendar.update') {
    if (data.calendar_id) {
      const status = await getRecallCalendarStatus(data.calendar_id)
      if (status) await setRecallCalendarStatus(data.calendar_id, status)
    }
    return NextResponse.json({ ok: true })
  }

  if (event !== 'transcript.done' && event !== 'transcript.failed') {
    return NextResponse.json({ ok: true, ignored: event })
  }

  const botId: string | undefined = data.bot?.id
  if (!botId) {
    // Desktop-SDK uploads have no bot; nothing for the worker to fetch.
    return NextResponse.json({ ok: true, ignored: 'no bot' })
  }

  const failed = event === 'transcript.failed'
  const queued = await enqueueRecallBot({
    botId,
    recordingId: data.recording?.id ?? null,
    transcriptId: data.transcript?.id ?? null,
    status: failed ? 'error' : 'pending',
    notes: failed ? `transcript.failed: ${data.data?.sub_code ?? data.data?.code ?? 'unknown'}` : null,
  })
  return NextResponse.json({ ok: true, queued })
}
