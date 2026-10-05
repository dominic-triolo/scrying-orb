import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRecallCalendar, saveRecallCalendar } from '@/lib/db'
import { connectRecallCalendar, exchangeCode, verifyState } from '@/lib/recallCalendar'

export const dynamic = 'force-dynamic'

function back(result: string) {
  const base = (process.env.NEXTAUTH_URL ?? '').replace(/\/$/, '')
  return NextResponse.redirect(`${base}/?notetaker=${result}`)
}

/** Google redirects here after the rep approves (or declines) calendar access. */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email?.toLowerCase()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  if (!verifyState(searchParams.get('state'), email)) return back('error')
  const code = searchParams.get('code')
  if (!code) return back('declined')   // user hit Cancel on the consent screen

  try {
    const granted = await exchangeCode(code)
    // The Google account picker lets a user choose any account; only the rep's
    // own calendar may be attached to their orb login.
    if (granted.email !== email) return back('wrong_account')

    const existing = await getRecallCalendar(email)
    const calendarId = await connectRecallCalendar(
      granted.refreshToken, email, existing?.recall_calendar_id ?? null
    )
    await saveRecallCalendar(email, calendarId)
    return back('connected')
  } catch (err) {
    console.error('Notetaker calendar connect failed', err)
    return back('error')
  }
}
