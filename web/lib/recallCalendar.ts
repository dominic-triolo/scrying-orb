import crypto from 'crypto'

// Connecting a rep's Google Calendar to Recall.ai so the notetaker bot auto-joins
// their calls. The rep authorizes read-only calendar access against the orb's own
// Google OAuth client; the resulting refresh token is handed to Recall, which owns
// it from then on (we never store it).

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')
const STATE_TTL_SECONDS = 10 * 60

export function recallConfigured(): boolean {
  return Boolean(process.env.RECALL_API_KEY)
}

export function calendarRedirectUri(): string {
  return `${(process.env.NEXTAUTH_URL ?? '').replace(/\/$/, '')}/api/recall/calendar/callback`
}

// ── OAuth state (CSRF) ─────────────────────────────────────────────────────────
// Signed with NEXTAUTH_SECRET and bound to the signed-in email, so a callback can
// only complete a flow that this same user started in the last few minutes.

function sign(payload: string): string {
  return crypto.createHmac('sha256', process.env.NEXTAUTH_SECRET!).update(payload).digest('base64url')
}

export function createState(email: string): string {
  const payload = Buffer.from(
    JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS })
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function verifyState(state: string | null, email: string): boolean {
  if (!state) return false
  const [payload, sig] = state.split('.')
  if (!payload || !sig) return false
  const expected = sign(payload)
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(new Uint8Array(Buffer.from(sig)), new Uint8Array(Buffer.from(expected)))) {
    return false
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return data.email === email && typeof data.exp === 'number' && data.exp > Date.now() / 1000
  } catch {
    return false
  }
}

// ── Google ─────────────────────────────────────────────────────────────────────

export function googleAuthUrl(email: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: calendarRedirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',          // always return a refresh token
    login_hint: email,
    state: createState(email),
  })
  return `${GOOGLE_AUTH_URL}?${params}`
}

/** Exchange the authorization code. Returns the refresh token and the Google
 *  account that actually granted it (which the caller must check). */
export async function exchangeCode(code: string): Promise<{ refreshToken: string; email: string }> {
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: calendarRedirectUri(),
      grant_type: 'authorization_code',
    }),
  })
  const tokens = await tokenRes.json()
  if (!tokenRes.ok || !tokens.refresh_token) {
    throw new Error(`Google token exchange failed: ${tokens.error ?? 'no refresh token'}`)
  }
  const infoRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const info = await infoRes.json()
  if (!infoRes.ok || !info.email) throw new Error('Google userinfo lookup failed')
  return { refreshToken: tokens.refresh_token, email: String(info.email).toLowerCase() }
}

// ── Recall calendar API (v2) ───────────────────────────────────────────────────

function recallUrl(path: string): string {
  const region = process.env.RECALL_REGION ?? 'us-west-2'
  return `https://${region}.recall.ai/api/v2${path}`
}

async function recallFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(recallUrl(path), {
    ...init,
    headers: {
      Authorization: `Token ${process.env.RECALL_API_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

function oauthBody(refreshToken: string) {
  return {
    platform: 'google_calendar',
    oauth_client_id: process.env.GOOGLE_CLIENT_ID,
    oauth_client_secret: process.env.GOOGLE_CLIENT_SECRET,
    oauth_refresh_token: refreshToken,
  }
}

/** Create the Recall calendar, or — when `existingId` is given and still exists —
 *  hand it the fresh refresh token (the reconnect path). Returns the calendar id. */
export async function connectRecallCalendar(
  refreshToken: string,
  email: string,
  existingId: string | null
): Promise<string> {
  if (existingId) {
    const res = await recallFetch(`/calendars/${existingId}/`, {
      method: 'PATCH',
      body: JSON.stringify(oauthBody(refreshToken)),
    })
    if (res.ok) return existingId
    if (res.status !== 404) throw new Error(`Recall calendar update failed (${res.status})`)
    // Deleted on Recall's side — fall through and create a new one.
  }
  const res = await recallFetch('/calendars/', {
    method: 'POST',
    body: JSON.stringify({ ...oauthBody(refreshToken), metadata: { email } }),
  })
  if (!res.ok) throw new Error(`Recall calendar create failed (${res.status})`)
  return (await res.json()).id
}

/** Delete the calendar in Recall, which also unschedules its future bots. */
export async function deleteRecallCalendar(calendarId: string): Promise<void> {
  const res = await recallFetch(`/calendars/${calendarId}/`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new Error(`Recall calendar delete failed (${res.status})`)
}

export async function getRecallCalendarStatus(calendarId: string): Promise<string | null> {
  const res = await recallFetch(`/calendars/${calendarId}/`)
  if (!res.ok) return null
  return (await res.json()).status ?? null
}
