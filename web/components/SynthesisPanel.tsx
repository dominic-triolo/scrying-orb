'use client'

import { useState } from 'react'

const FIELD_LABELS: Record<string, string> = {
  summary:               'Summary',
  next_steps:            'Next Steps',
  concerns_objections:   'Concerns & Objections',
  motivated_by:          'Motivated By',
  rapport:               'Rapport',
  personal_details:      'Personal Details',
  positive_moments:      'Positive Moments',
  eagerness_level:       'Eagerness Level',
  destinations_mentioned:'Destinations Mentioned',
  ideal_trip_time:       'Ideal Trip Time',
}

// Summary renders expanded by default; others start collapsed
const DEFAULT_OPEN = new Set(['summary', 'next_steps', 'eagerness_level'])

function Section({ label, content }: { label: string; content: unknown }) {
  const [open, setOpen] = useState(DEFAULT_OPEN.has(
    Object.entries(FIELD_LABELS).find(([, v]) => v === label)?.[0] ?? ''
  ))

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors text-left"
      >
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
          <p className="text-sm text-gray-700 prose-pre leading-relaxed">
            {Array.isArray(content) ? content.join('\n') : String(content ?? '')}
          </p>
        </div>
      )}
    </div>
  )
}

export default function SynthesisPanel({
  synthesis,
}: {
  synthesis: Record<string, unknown> | null
}) {
  if (!synthesis) {
    return (
      <p className="text-sm text-gray-400 italic">
        AI synthesis is pending — the synthesis service will process this meeting shortly.
      </p>
    )
  }

  const entries = Object.entries(synthesis).filter(([, v]) => typeof v === 'string' ? v.trim() : v != null)

  if (entries.length === 0) {
    return <p className="text-sm text-gray-400 italic">No synthesis output available.</p>
  }

  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <Section
          key={key}
          label={FIELD_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          content={value}
        />
      ))}
    </div>
  )
}
