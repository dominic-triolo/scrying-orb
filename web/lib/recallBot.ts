// Sending the notetaker into a meeting on demand — the manual fallback for when it
// didn't join on its own (calendar not connected, recurring series, a call set up
// at the last minute). Bots created here go through the same webhook → worker
// pipeline as calendar-scheduled ones.

const INTERNAL_DOMAIN = 'trovatrip.com'
const METADATA_MAX = 500   // Recall's per-value limit on bot metadata

// Keep in step with BOT_NAME / RECORDING_CONFIG / AUTOMATIC_LEAVE in synthesis/recall.py —
// a bot added by hand should behave exactly like one the calendar scheduled.
const BOT_NAME = 'TrovaTrip Notetaker'
const RECORDING_CONFIG = {
  transcript: {
    provider: { recallai_streaming: { mode: 'prioritize_accuracy', language_code: 'auto' } },
  },
}
const AUTOMATIC_LEAVE = { everyone_left_timeout: { timeout: 60 } }

// A bot in any of these states is in the call or on its way there.
const ACTIVE_STATUSES = new Set([
  'joining_call', 'in_waiting_room', 'in_call_not_recording',
  'recording_permission_allowed', 'in_call_recording',
])

function recallUrl(path: string): string {
  const region = process.env.RECALL_REGION ?? 'us-west-2'
  return `https://${region}.recall.ai/api/v1${path}`
}

function headers() {
  return {
    Authorization: `Token ${process.env.RECALL_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

/** Accepts a Google Meet link in any pasted form and returns the canonical URL,
 *  or null if it isn't one. */
export function parseMeetUrl(input: string): string | null {
  const match = input.trim().match(
    /^(?:https?:\/\/)?meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#].*)?$/i
  )
  return match ? `https://meet.google.com/${match[1].toLowerCase()}` : null
}

/** Free-text guest emails → the comma-separated external list the worker expects.
 *  Returns null if anything in the input isn't an email address. */
export function parseExternalEmails(input: string): string | null {
  const parts = input.split(/[\s,;]+/).map((p) => p.trim().toLowerCase()).filter(Boolean)
  if (parts.some((p) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p))) return null
  const external = Array.from(new Set(parts)).filter((p) => !p.endsWith(`@${INTERNAL_DOMAIN}`))
  let out = ''
  for (const email of external) {
    const next = out ? `${out}, ${email}` : email
    if (next.length > METADATA_MAX) break
    out = next
  }
  return out
}

/** Is a notetaker already in (or joining) this meeting? Guards against a second
 *  bot — and a duplicate meeting record — when a rep clicks twice or the calendar
 *  bot is merely slow. */
export async function hasActiveBot(meetingUrl: string): Promise<boolean> {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const params = new URLSearchParams({ meeting_url: meetingUrl, join_at_after: since })
  const res = await fetch(recallUrl(`/bot/?${params}`), { headers: headers() })
  if (!res.ok) throw new Error(`Recall bot lookup failed (${res.status})`)
  const bots: { status_changes?: { code: string }[] }[] = (await res.json()).results ?? []
  return bots.some((bot) => {
    const latest = bot.status_changes?.[bot.status_changes.length - 1]?.code
    return latest !== undefined && ACTIVE_STATUSES.has(latest)
  })
}

/** Send the notetaker into a meeting now. Returns the Recall bot id. */
export async function sendBot(args: {
  meetingUrl: string
  meetingName: string
  owner: string
  externalAttendees: string
}): Promise<string> {
  const res = await fetch(recallUrl('/bot/'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      meeting_url: args.meetingUrl,
      bot_name: BOT_NAME,
      recording_config: RECORDING_CONFIG,
      automatic_leave: AUTOMATIC_LEAVE,
      metadata: {
        meeting_name: args.meetingName.slice(0, METADATA_MAX),
        recording_owner: args.owner,
        external_attendees: args.externalAttendees,
        added_manually: 'true',
      },
    }),
  })
  if (!res.ok) throw new Error(`Recall bot create failed (${res.status})`)
  return (await res.json()).id
}
