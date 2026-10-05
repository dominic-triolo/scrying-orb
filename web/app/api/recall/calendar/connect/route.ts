import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { googleAuthUrl, recallConfigured } from '@/lib/recallCalendar'

export const dynamic = 'force-dynamic'

/** Start the "Connect calendar" flow: send the signed-in rep to Google's consent
 *  screen for read-only calendar access. Finishes in ../callback. */
export async function GET() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!recallConfigured()) {
    return NextResponse.json({ error: 'Notetaker not configured' }, { status: 503 })
  }
  return NextResponse.redirect(googleAuthUrl(email.toLowerCase()))
}
