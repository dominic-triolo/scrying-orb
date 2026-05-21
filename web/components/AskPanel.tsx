'use client'

import { useRef, useState } from 'react'

interface QAPair {
  question: string
  answer: string
}

interface AskPanelProps {
  meetingId: string
  hasTranscript: boolean
}

export default function AskPanel({ meetingId, hasTranscript }: AskPanelProps) {
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<QAPair[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  async function ask() {
    const q = question.trim()
    if (!q || loading) return

    setLoading(true)
    setError(null)
    setQuestion('')

    try {
      const res = await fetch(`/api/meetings/${meetingId}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to get answer')
      setHistory((prev) => [...prev, { question: q, answer: data.answer }])
      // Scroll to latest answer
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      // Restore question so user can retry
      setQuestion(q)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      ask()
    }
  }

  if (!hasTranscript) {
    return (
      <div className="max-w-3xl">
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-8 text-center">
          <p className="text-sm text-gray-400">No transcript available — questions can't be answered without one.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl flex flex-col gap-4">

      {/* Q&A history */}
      {history.length > 0 && (
        <div className="space-y-4">
          {history.map((pair, i) => (
            <div key={i} className="space-y-2">
              {/* Question bubble */}
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-2.5 text-sm text-white">
                  {pair.question}
                </div>
              </div>
              {/* Answer bubble */}
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white border border-gray-200 px-4 py-2.5 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {pair.answer}
                </div>
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-tl-sm bg-white border border-gray-200 px-4 py-3">
                <div className="flex gap-1 items-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce" />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Input */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        {history.length === 0 && !loading && (
          <p className="text-xs text-gray-400 mb-3">
            Ask anything about this call — e.g. "When did they want to launch?" or "What destinations came up?"
          </p>
        )}
        <div className="flex gap-3 items-end">
          <textarea
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder="Ask a question about this meeting…"
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={ask}
            disabled={!question.trim() || loading}
            className="flex-shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Ask
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Press Enter to send · Shift+Enter for new line</p>
      </div>

    </div>
  )
}
