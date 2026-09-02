'use client'

import { useRef, useState } from 'react'

interface Message { role: 'user' | 'assistant'; content: string }

export default function AnalysisChat({
  jobId,
  initialMessages,
}: {
  jobId: string
  initialMessages: Message[]
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  async function ask() {
    const q = question.trim()
    if (!q || loading) return
    setLoading(true); setError(null); setQuestion('')
    setMessages((prev) => [...prev, { role: 'user', content: q }])
    try {
      const res = await fetch(`/api/analysis/${jobId}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to get answer')
      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer }])
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setMessages((prev) => prev.slice(0, -1)) // drop the optimistic question
      setQuestion(q)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() }
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.length > 0 && (
        <div className="space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'rounded-2xl rounded-tr-sm bg-blue-600 text-white'
                  : 'rounded-2xl rounded-tl-sm bg-white border border-gray-200 text-gray-800'
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

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

      {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        {messages.length === 0 && !loading && (
          <p className="text-xs text-gray-400 mb-3">
            Ask a follow-up — e.g. &quot;Which rep defaulted to survey most?&quot; or &quot;Show examples where discovery was strong.&quot;
          </p>
        )}
        <div className="flex gap-3 items-end">
          <textarea
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder="Ask a follow-up about this analysis…"
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={ask} disabled={!question.trim() || loading}
            className="flex-shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            Ask
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Press Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
