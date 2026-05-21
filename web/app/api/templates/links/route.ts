import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { addApprovedLink } from '@/lib/db'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { url, label } = await req.json()
  if (!url?.trim() || !label?.trim()) {
    return NextResponse.json({ error: 'url and label are required' }, { status: 400 })
  }

  const link = await addApprovedLink(url.trim(), label.trim())
  return NextResponse.json(link)
}
