'use client'

import { useEffect, useState, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import Sidebar from '@/components/Sidebar'
import MeetingCard from '@/components/MeetingCard'
import type { Meeting } from '@/lib/db'

export default function HomePage() {
  const { data: session } = useSession()
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)

  // Filter state
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showMyMeetings, setShowMyMeetings] = useState(false)

  // Detect leadership client-side from the meeting list
  // (leadership see other reps' meetings; reps only see their own)
  const userEmail = session?.user?.email ?? ''
  const [isLeadership, setIsLeadership] = useState(false)

  useEffect(() => {
    fetch('/api/meetings')
      .then((r) => r.json())
      .then((data: Meeting[]) => {
        setMeetings(data)
        // If we can see meetings owned by other reps, we're leadership
        const ownsOthers = data.some((m) => m.recording_owner !== userEmail)
        setIsLeadership(ownsOthers)
      })
      .finally(() => setLoading(false))
  }, [userEmail])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const from = dateFrom ? new Date(dateFrom) : null
    const to = dateTo ? new Date(dateTo + 'T23:59:59') : null

    return meetings.filter((m) => {
      if (typeFilter && m.meeting_type !== typeFilter) return false
      if (showMyMeetings && m.recording_owner !== userEmail) return false
      if (from && m.meeting_datetime && new Date(m.meeting_datetime) < from) return false
      if (to && m.meeting_datetime && new Date(m.meeting_datetime) > to) return false
      if (q) {
        const inTitle = m.meeting_name.toLowerCase().includes(q)
        const inAttendees = m.attendees.some((a) => a.toLowerCase().includes(q))
        if (!inTitle && !inAttendees) return false
      }
      return true
    })
  }, [meetings, search, typeFilter, dateFrom, dateTo, showMyMeetings, userEmail])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        search={search} onSearchChange={setSearch}
        typeFilter={typeFilter} onTypeFilterChange={setTypeFilter}
        dateFrom={dateFrom} onDateFromChange={setDateFrom}
        dateTo={dateTo} onDateToChange={setDateTo}
        showMyMeetings={showMyMeetings} onShowMyMeetingsChange={setShowMyMeetings}
        isLeadership={isLeadership}
      />

      <main className="flex-1 overflow-y-auto px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Meetings</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading ? 'Loading…' : `${filtered.length} meeting${filtered.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 h-40 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-gray-400 text-sm">No meetings match your filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((m) => (
              <MeetingCard key={m.id} meeting={m} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
