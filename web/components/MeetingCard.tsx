import Link from 'next/link'
import TypeBadge from './TypeBadge'
import type { Meeting } from '@/lib/db'

function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown date'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function repFirstName(email: string | null): string {
  if (!email) return 'Unknown'
  return email.split('@')[0].split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

export default function MeetingCard({ meeting }: { meeting: Meeting }) {
  const hasRatio = meeting.rep_talk_pct != null && meeting.prospect_talk_pct != null

  return (
    <Link href={`/meetings/${meeting.id}`} className="block">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-blue-300 transition-all">
        <div className="flex items-start justify-between gap-2 mb-3">
          <TypeBadge type={meeting.meeting_type} />
          <span className="text-xs text-gray-400 whitespace-nowrap">{formatDate(meeting.meeting_datetime)}</span>
        </div>

        <h3 className="font-semibold text-gray-900 text-sm leading-snug mb-1 line-clamp-2">
          {meeting.meeting_name}
        </h3>

        <p className="text-xs text-gray-500 mb-3">{repFirstName(meeting.recording_owner)}</p>

        {/* Attendees */}
        {meeting.attendees.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {meeting.attendees.slice(0, 3).map((email) => (
              <span key={email} className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 truncate max-w-[140px]">
                {email}
              </span>
            ))}
            {meeting.attendees.length > 3 && (
              <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                +{meeting.attendees.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Talk ratio */}
        {hasRatio && (
          <div className="mt-auto">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Rep {meeting.rep_talk_pct}%</span>
              <span>Prospect {meeting.prospect_talk_pct}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-400"
                style={{ width: `${meeting.rep_talk_pct}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Link>
  )
}
