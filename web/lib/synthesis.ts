import fs from 'fs'
import path from 'path'
import { callGemini } from '@/lib/gemini'

/**
 * On-demand meeting synthesis for the web app.
 *
 * This mirrors the Python synthesis worker (synthesis/gemini.py) so a rep can
 * synthesize a legacy / imported meeting on request and get the same synthesis_output
 * shape as a live meeting. It deliberately runs in the web process (synchronous,
 * instant feedback) rather than the worker, and never touches the nurture emit path —
 * imported historical meetings must not enter the nurture pipeline.
 *
 * The prompt files in web/prompts/*.txt are copies of synthesis/prompts/*.txt.
 * Keep them in sync when the synthesis prompts change.
 */

const PROMPT_DIR = path.join(process.cwd(), 'prompts')
const USER_PROMPT_PREFIX =
  'Analyze the following meeting transcript and return the JSON object as specified.\n\nTRANSCRIPT:\n'

function loadPrompt(meetingType: string): string {
  // Mirror the worker: unknown types fall back to the nurture prompt.
  const safe = /^[a-z0-9_-]+$/.test(meetingType ?? '') ? meetingType : 'nurture'
  const file = path.join(PROMPT_DIR, `${safe}.txt`)
  const target = fs.existsSync(file) ? file : path.join(PROMPT_DIR, 'nurture.txt')
  return fs.readFileSync(target, 'utf-8')
}

/**
 * Escape literal control characters inside JSON string values. Gemini sometimes
 * emits real newlines/tabs inside strings instead of \n/\t, which breaks JSON.parse.
 * Walks the text tracking string context. (Port of gemini.py::_escape_control_chars.)
 */
function escapeControlChars(text: string): string {
  const out: string[] = []
  let inString = false
  let escaped = false
  const map: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' }
  for (const ch of text) {
    if (escaped) {
      out.push(ch)
      escaped = false
    } else if (ch === '\\' && inString) {
      out.push(ch)
      escaped = true
    } else if (ch === '"') {
      out.push(ch)
      inString = !inString
    } else if (inString && ch.charCodeAt(0) < 32) {
      out.push(map[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
    } else {
      out.push(ch)
    }
  }
  return out.join('')
}

/** Extract and parse the JSON object from Gemini's response. */
function extractJson(text: string): Record<string, unknown> {
  let cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const attempts = [
    () => JSON.parse(cleaned),
    () => JSON.parse(escapeControlChars(cleaned)),
    () => {
      const m = cleaned.match(/\{[\s\S]*\}/)
      if (!m) throw new Error('no object found')
      return JSON.parse(escapeControlChars(m[0]))
    },
  ]
  for (const attempt of attempts) {
    try {
      return attempt()
    } catch {
      /* try next */
    }
  }
  throw new Error('Could not parse JSON from Gemini synthesis response')
}

/**
 * Run synthesis for a transcript + meeting type. Retries on JSON-parse failure
 * (Gemini is non-deterministic, so a retry usually yields valid output).
 */
export async function runSynthesis(
  transcript: string,
  meetingType: string,
  maxRetries = 3
): Promise<Record<string, unknown>> {
  const systemInstruction = loadPrompt(meetingType)
  const prompt = USER_PROMPT_PREFIX + transcript

  let lastError: unknown = null
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const raw = await callGemini(prompt, { systemInstruction, jsonMode: true })
    try {
      return extractJson(raw)
    } catch (err) {
      lastError = err
    }
  }
  throw new Error(
    `Gemini synthesis JSON parsing failed after ${maxRetries} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  )
}
