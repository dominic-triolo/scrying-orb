const OUTCOME_CONFIG: Record<string, { label: string; classes: string }> = {
  COMPLETED:   { label: 'Completed',   classes: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  NO_SHOW:     { label: 'No Show',     classes: 'bg-red-50 border-red-200 text-red-700' },
  CANCELLED:   { label: 'Cancelled',   classes: 'bg-gray-100 border-gray-300 text-gray-600' },
  RESCHEDULED: { label: 'Rescheduled', classes: 'bg-blue-50 border-blue-200 text-blue-700' },
}

export default function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return null
  const normalized = outcome.toUpperCase()
  const { label, classes } = OUTCOME_CONFIG[normalized] ?? {
    label: outcome.replace(/_/g, ' '),
    classes: 'bg-gray-100 border-gray-200 text-gray-600',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {label}
    </span>
  )
}
