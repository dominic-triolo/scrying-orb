import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getTemplates, getApprovedLinks } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [templates, links] = await Promise.all([getTemplates(), getApprovedLinks()])
  return NextResponse.json({ templates, links })
}
