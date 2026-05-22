import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (session.error === 'RefreshTokenError') {
    return NextResponse.json(
      { error: 'Gmail token expired — please sign out and back in' },
      { status: 401 }
    )
  }

  const accessToken = session.access_token
  if (!accessToken) {
    return NextResponse.json(
      { error: 'No Gmail access token — please sign out and back in' },
      { status: 401 }
    )
  }

  const { to, cc, subject, body } = await req.json()
  if (!to || !subject || !body) {
    return NextResponse.json({ error: 'Missing required fields: to, subject, body' }, { status: 400 })
  }

  // Build RFC 2822 HTML message
  const headers: string[] = [
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    '',
  ]
  const htmlBody = `<!DOCTYPE html><html><body style="font-family:sans-serif;font-size:14px;line-height:1.6;">${body}</body></html>`
  const message = [...headers, htmlBody].join('\r\n')

  const raw = Buffer.from(message).toString('base64url')

  const gmailRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    }
  )

  if (!gmailRes.ok) {
    const errText = await gmailRes.text()
    console.error('Gmail send failed:', gmailRes.status, errText)
    let gmailMessage = `Gmail error ${gmailRes.status}`
    try {
      const parsed = JSON.parse(errText)
      gmailMessage = parsed?.error?.message ?? gmailMessage
    } catch { /* use status fallback */ }
    return NextResponse.json({ error: gmailMessage }, { status: 502 })
  }

  return NextResponse.json({ success: true })
}
