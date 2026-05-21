'use client'

import { useEffect, useRef, useState } from 'react'

// ── Toolbar button ─────────────────────────────────────────────────────────
function ToolbarBtn({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      title={title}
      className={`px-2 py-1 rounded text-sm transition-colors ${
        active
          ? 'bg-blue-100 text-blue-700'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      {children}
    </button>
  )
}

// ── Rich text editor ───────────────────────────────────────────────────────
export default function RichEditor({
  initialHtml,
  editorRef,
  minHeight = 'min-h-[160px]',
  placeholder,
}: {
  initialHtml: string
  editorRef: React.RefObject<HTMLDivElement>
  minHeight?: string
  placeholder?: string
}) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const savedRangeRef = useRef<Range | null>(null)

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = initialHtml
    }
  // only run when initialHtml changes from outside (new content loaded)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml])

  function exec(cmd: string, value?: string) {
    document.execCommand(cmd, false, value)
    editorRef.current?.focus()
  }

  function openLinkPrompt() {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange()
    }
    setLinkOpen(true)
  }

  function insertLink() {
    if (!linkUrl) return
    const url = /^https?:\/\//i.test(linkUrl) ? linkUrl : `https://${linkUrl}`
    const sel = window.getSelection()
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges()
      sel.addRange(savedRangeRef.current)
    }
    exec('createLink', url)
    editorRef.current?.querySelectorAll('a:not([target])').forEach((a) => {
      ;(a as HTMLAnchorElement).target = '_blank'
      ;(a as HTMLAnchorElement).rel = 'noopener noreferrer'
    })
    setLinkUrl('')
    setLinkOpen(false)
  }

  return (
    <div className="rounded-lg border border-gray-300 overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 bg-gray-50 px-2 py-1.5">
        <ToolbarBtn onClick={() => exec('bold')} title="Bold">
          <strong>B</strong>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec('italic')} title="Italic">
          <em>I</em>
        </ToolbarBtn>
        <span className="w-px h-4 bg-gray-300 mx-1" />
        <ToolbarBtn onClick={() => exec('insertUnorderedList')} title="Bullet list">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec('insertOrderedList')} title="Numbered list">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M7 6h13M7 12h13M7 18h13M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
        </ToolbarBtn>
        <span className="w-px h-4 bg-gray-300 mx-1" />
        <ToolbarBtn onClick={openLinkPrompt} active={linkOpen} title="Insert link">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </ToolbarBtn>
      </div>

      {/* Inline link prompt */}
      {linkOpen && (
        <div className="flex items-center gap-2 border-b border-gray-200 bg-blue-50 px-3 py-2">
          <input
            autoFocus
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); insertLink() }
              if (e.key === 'Escape') { setLinkOpen(false); setLinkUrl('') }
            }}
            placeholder="https://example.com"
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button type="button" onClick={insertLink}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
          >
            Insert
          </button>
          <button type="button" onClick={() => { setLinkOpen(false); setLinkUrl('') }}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Editable body */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        className={`${minHeight} px-3 py-2 text-sm text-gray-800 focus:outline-none [&_a]:text-blue-600 [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400`}
      />
    </div>
  )
}
