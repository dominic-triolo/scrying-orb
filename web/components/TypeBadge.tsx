const styles: Record<string, string> = {
  intro:    'bg-blue-100 text-blue-700',
  planning: 'bg-purple-100 text-purple-700',
  nurture:  'bg-green-100 text-green-700',
}

export default function TypeBadge({ type }: { type: string | null }) {
  if (!type) return null
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${styles[type] ?? 'bg-gray-100 text-gray-600'}`}>
      {type}
    </span>
  )
}
