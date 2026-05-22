'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface MeetingTypeConfig {
  id: string
  label: string
  scoreable: boolean
  sort_order: number
}

const emptyForm = { id: '', label: '', scoreable: false, sort_order: 0 }

export default function MeetingTypeSetupPage() {
  const router = useRouter()
  const [types, setTypes] = useState<MeetingTypeConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Add form
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState(emptyForm)

  // Inline edit state: keyed by type id
  const [editing, setEditing] = useState<Record<string, { label: string; scoreable: boolean; sort_order: number }>>({})

  // Confirm delete
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    // Gate to admins only
    fetch('/api/me').then((r) => r.json()).then((d) => {
      if (!d.isLeadership) router.replace('/')
    })
    fetch('/api/meeting-types')
      .then((r) => r.json())
      .then((data) => { setTypes(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [router])

  async function saveNew() {
    setError(null); setSaving(true)
    try {
      const res = await fetch('/api/meeting-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to save')
      setTypes(data)
      setAddForm(emptyForm)
      setShowAdd(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  async function saveEdit(id: string) {
    setError(null); setSaving(true)
    const form = editing[id]
    try {
      const res = await fetch(`/api/meeting-types/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to save')
      setTypes(data)
      setEditing((prev) => { const next = { ...prev }; delete next[id]; return next })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  async function deleteType(id: string) {
    setError(null); setSaving(true)
    try {
      const res = await fetch(`/api/meeting-types/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to delete')
      setTypes(data)
      setConfirmDelete(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  function startEdit(t: MeetingTypeConfig) {
    setEditing((prev) => ({
      ...prev,
      [t.id]: { label: t.label, scoreable: t.scoreable, sort_order: t.sort_order },
    }))
  }

  function cancelEdit(id: string) {
    setEditing((prev) => { const next = { ...prev }; delete next[id]; return next })
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-sm text-gray-400">Loading…</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link href="/" className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Meeting Type Setup</h1>
            <p className="text-sm text-gray-500 mt-0.5">Manage the meeting types used across scoring, templates, and outreach.</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Types table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ID</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Label</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Scoreable</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Order</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {types.map((t) => {
                const isEditing = !!editing[t.id]
                const form = editing[t.id]
                return (
                  <tr key={t.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3 font-mono text-gray-600 text-xs">{t.id}</td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          value={form.label}
                          onChange={(e) => setEditing((prev) => ({ ...prev, [t.id]: { ...form, label: e.target.value } }))}
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="text-gray-800">{t.label}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isEditing ? (
                        <input
                          type="checkbox"
                          checked={form.scoreable}
                          onChange={(e) => setEditing((prev) => ({ ...prev, [t.id]: { ...form, scoreable: e.target.checked } }))}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      ) : (
                        t.scoreable
                          ? <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" title="Scoreable" />
                          : <span className="inline-block h-2 w-2 rounded-full bg-gray-300" title="Not scoreable" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isEditing ? (
                        <input
                          type="number"
                          value={form.sort_order}
                          onChange={(e) => setEditing((prev) => ({ ...prev, [t.id]: { ...form, sort_order: Number(e.target.value) } }))}
                          className="w-16 rounded border border-gray-300 px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="text-gray-500">{t.sort_order}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {isEditing ? (
                          <>
                            <button onClick={() => saveEdit(t.id)} disabled={saving}
                              className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50">
                              Save
                            </button>
                            <button onClick={() => cancelEdit(t.id)}
                              className="text-xs text-gray-400 hover:text-gray-600">
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(t)}
                              className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
                              Edit
                            </button>
                            {confirmDelete === t.id ? (
                              <>
                                <button onClick={() => deleteType(t.id)} disabled={saving}
                                  className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50">
                                  Confirm
                                </button>
                                <button onClick={() => setConfirmDelete(null)}
                                  className="text-xs text-gray-400 hover:text-gray-600">
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button onClick={() => setConfirmDelete(t.id)}
                                className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                                Delete
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {types.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">No meeting types yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Add form */}
        {showAdd ? (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">New Meeting Type</h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">ID (slug)</label>
                <input
                  value={addForm.id}
                  onChange={(e) => setAddForm({ ...addForm, id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                  placeholder="e.g. discovery"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-400">Lowercase, no spaces. Cannot be changed after saving.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Label</label>
                <input
                  value={addForm.label}
                  onChange={(e) => setAddForm({ ...addForm, label: e.target.value })}
                  placeholder="e.g. Discovery Call"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Sort Order</label>
                <input
                  type="number"
                  value={addForm.sort_order}
                  onChange={(e) => setAddForm({ ...addForm, sort_order: Number(e.target.value) })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={addForm.scoreable}
                    onChange={(e) => setAddForm({ ...addForm, scoreable: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Scoreable (show in Scorecard Setup)</span>
                </label>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={saveNew} disabled={saving || !addForm.id || !addForm.label}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {saving ? 'Saving…' : 'Add Meeting Type'}
              </button>
              <button onClick={() => { setShowAdd(false); setAddForm(emptyForm) }}
                className="text-sm text-gray-500 hover:text-gray-700">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Meeting Type
          </button>
        )}

        {/* Legend */}
        <div className="mt-8 rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700">
          <strong>Scoreable</strong> types appear as tabs in Scorecard Setup and trigger the Coaching tab on meeting detail pages.
          All types appear in the meeting type dropdown and in Templates.
        </div>
      </div>
    </div>
  )
}
