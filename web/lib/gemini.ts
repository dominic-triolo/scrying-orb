const MODELS = [
  'gemini-2.5-flash',
  'gemini-1.5-flash',
]

const RETRYABLE = new Set([429, 503])

interface GeminiOptions {
  systemInstruction?: string
  jsonMode?: boolean
}

/**
 * Call Gemini with automatic model fallback.
 * Tries each model in MODELS order, falling back on 429/503.
 * Returns the response text, or throws on unrecoverable error.
 */
export async function callGemini(
  prompt: string,
  options: GeminiOptions = {}
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('Gemini not configured')

  let lastError = ''

  for (const model of MODELS) {
    const body: Record<string, unknown> = {
      contents: [{ parts: [{ text: prompt }] }],
    }

    if (options.systemInstruction) {
      body.systemInstruction = { parts: [{ text: options.systemInstruction }] }
    }

    if (options.jsonMode) {
      body.generationConfig = { responseMimeType: 'application/json' }
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )

    if (res.ok) {
      const data = await res.json()
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    }

    const errText = await res.text()

    if (RETRYABLE.has(res.status)) {
      console.warn(`Gemini ${model} returned ${res.status}, trying next model`)
      lastError = `${res.status} on ${model}`
      continue
    }

    // Non-retryable error — fail immediately
    throw new Error(`Gemini error: ${res.status} — ${errText}`)
  }

  throw new Error(`All Gemini models unavailable. Last error: ${lastError}`)
}
