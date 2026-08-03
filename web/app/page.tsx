'use client'

import { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import MeetingCard from '@/components/MeetingCard'
import type { Meeting } from '@/lib/db'

const PAGE_SIZE = 60

interface MeetingsResponse {
  meetings: Meeting[]
  total: number
}

export default function HomePage() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  // Filter state (server-backed — the table has ~7k rows, so filtering is done in SQL)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showMyMeetings, setShowMyMeetings] = useState(false)
  const [isLeadership, setIsLeadership] = useState(false)

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.isLeadership) setIsLeadership(true) })
      .catch(() => {})
  }, [])

  const buildQuery = useCallback((offset: number) => {
    const p = new URLSearchParams()
    if (search.trim()) p.set('q', search.trim())
    if (typeFilter) p.set('type', typeFilter)
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo) p.set('to', dateTo)
    if (showMyMeetings) p.set('mine', '1')
    p.set('limit', String(PAGE_SIZE))
    p.set('offset', String(offset))
    return p.toString()
  }, [search, typeFilter, dateFrom, dateTo, showMyMeetings])

  // Reload the first page whenever a filter changes (debounced so typing in the
  // search box doesn't fire a request per keystroke). Old results stay visible
  // during the debounce; the skeleton only shows once a fetch actually starts.
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true)
      fetch(`/api/meetings?${buildQuery(0)}`)
        .then((r) => r.json())
        .then((data: MeetingsResponse) => {
          setMeetings(data.meetings ?? [])
          setTotal(data.total ?? 0)
        })
        .catch(() => { setMeetings([]); setTotal(0) })
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(t)
  }, [buildQuery])

  function loadMore() {
    setLoadingMore(true)
    fetch(`/api/meetings?${buildQuery(meetings.length)}`)
      .then((r) => r.json())
      .then((data: MeetingsResponse) => {
        setMeetings((prev) => [...prev, ...(data.meetings ?? [])])
        setTotal(data.total ?? 0)
      })
      .finally(() => setLoadingMore(false))
  }

  const hasMore = meetings.length < total

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
              {loading
                ? 'Loading…'
                : total === 0
                ? 'No meetings'
                : `Showing ${meetings.length} of ${total.toLocaleString()} meeting${total !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 h-40 animate-pulse" />
            ))}
          </div>
        ) : meetings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-gray-400 text-sm">No meetings match your filters.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {meetings.map((m) => (
                <MeetingCard key={m.id} meeting={m} />
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center mt-8">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-md border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {loadingMore ? 'Loading…' : `Load more (${(total - meetings.length).toLocaleString()} more)`}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
