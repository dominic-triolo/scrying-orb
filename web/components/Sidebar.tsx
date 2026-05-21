'use client'

import { useEffect, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface SidebarProps {
  search: string
  onSearchChange: (v: string) => void
  typeFilter: string
  onTypeFilterChange: (v: string) => void
  dateFrom: string
  onDateFromChange: (v: string) => void
  dateTo: string
  onDateToChange: (v: string) => void
  showMyMeetings: boolean
  onShowMyMeetingsChange: (v: boolean) => void
  isLeadership: boolean
}

export default function Sidebar({
  search, onSearchChange,
  typeFilter, onTypeFilterChange,
  dateFrom, onDateFromChange,
  dateTo, onDateToChange,
  showMyMeetings, onShowMyMeetingsChange,
  isLeadership,
}: SidebarProps) {
  const { data: session } = useSession()
  const pathname = usePathname()
  const isHome = pathname === '/'
  const [isLeadershipUser, setIsLeadershipUser] = useState(false)

  useEffect(() => {
    fetch('/api/me')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.isLeadership) setIsLeadershipUser(true) })
      .catch(() => {})
  }, [])

  return (
    <aside className="flex h-screen w-64 flex-shrink-0 flex-col bg-slate-900 text-white">
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 py-5 border-b border-slate-700">
        <div className="h-7 w-7 rounded-md bg-blue-500 flex items-center justify-center text-white font-bold text-sm">T</div>
        <span className="font-semibold text-sm tracking-wide">TrovaTrip Meetings</span>
      </div>

      {/* Nav */}
      <nav className="px-3 pt-4 space-y-1">
        <Link
          href="/"
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            isHome ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0l-7-7m7 7l-7 7" />
          </svg>
          All Meetings
        </Link>
        <Link
          href="/templates"
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            pathname === '/templates' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Templates
        </Link>
        {isLeadershipUser && (
          <Link
            href="/scorecard-setup"
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              pathname === '/scorecard-setup' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            Scorecard Setup
          </Link>
        )}
      </nav>

      {/* Search & Filters — only on home page */}
      {isHome && (
        <div className="flex-1 overflow-y-auto px-4 pt-6 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Filter</p>

          {/* Text search */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Search</label>
            <input
              type="text"
              placeholder="Title or attendee email..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Meeting type */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Meeting type</label>
            <select
              value={typeFilter}
              onChange={(e) => onTypeFilterChange(e.target.value)}
              className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All types</option>
              <option value="intro">Intro</option>
              <option value="planning">Planning</option>
              <option value="nurture">Nurture</option>
            </select>
          </div>

          {/* Date range */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Date from</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Date to</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* My meetings toggle (leadership only) */}
          {isLeadership && (
            <div className="flex items-center gap-2">
              <input
                id="my-meetings"
                type="checkbox"
                checked={showMyMeetings}
                onChange={(e) => onShowMyMeetingsChange(e.target.checked)}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
              />
              <label htmlFor="my-meetings" className="text-xs text-slate-400 cursor-pointer">
                My meetings only
              </label>
            </div>
          )}
        </div>
      )}

      {/* User footer */}
      <div className="border-t border-slate-700 px-4 py-4">
        <div className="flex items-center gap-3">
          {session?.user?.image && (
            <img src={session.user.image} alt="" className="h-7 w-7 rounded-full" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">{session?.user?.name}</p>
            <p className="text-xs text-slate-400 truncate">{session?.user?.email}</p>
          </div>
          <button
            onClick={() => signOut()}
            className="text-slate-400 hover:text-white transition-colors"
            title="Sign out"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  )
}
