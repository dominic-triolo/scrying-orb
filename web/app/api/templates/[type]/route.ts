import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { upsertTemplate } from '@/lib/db'

export async function PUT(
  req: NextRequest,
  { params }: { params: { type: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { note_example, email_subject_example, email_body_example } = await req.json()

  await upsertTemplate({
    meeting_type: params.type,
    note_example: note_example ?? null,
    email_subject_example: email_subject_example ?? null,
    email_body_example: email_body_example ?? null,
  })

  return NextResponse.json({ ok: true })
}
