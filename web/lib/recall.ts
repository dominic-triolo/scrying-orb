import crypto from 'crypto'

// Reject deliveries whose timestamp is further than this from now (replay guard).
const TOLERANCE_SECONDS = 5 * 60

/**
 * Verify a request from Recall.ai against the workspace verification secret
 * (docs.recall.ai/docs/authenticating-requests-from-recallai). Recall signs
 * `${id}.${timestamp}.${rawBody}` with HMAC-SHA256 and sends one or more
 * space-separated `v1,<base64>` signatures (several while a secret is rotating).
 * Returns false rather than throwing so the route can answer 401.
 */
export function verifyRecallRequest(secret: string, headers: Headers, rawBody: string): boolean {
  if (!secret.startsWith('whsec_')) return false

  const id = headers.get('webhook-id') ?? headers.get('svix-id')
  const timestamp = headers.get('webhook-timestamp') ?? headers.get('svix-timestamp')
  const signature = headers.get('webhook-signature') ?? headers.get('svix-signature')
  if (!id || !timestamp || !signature) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false

  const key = Buffer.from(secret.slice('whsec_'.length), 'base64')
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest()

  for (const versioned of signature.split(' ')) {
    const [version, sig] = versioned.split(',')
    if (version !== 'v1' || !sig) continue
    const passed = Buffer.from(sig, 'base64')
    if (passed.length === expected.length &&
        crypto.timingSafeEqual(new Uint8Array(passed), new Uint8Array(expected))) {
      return true
    }
  }
  return false
}
