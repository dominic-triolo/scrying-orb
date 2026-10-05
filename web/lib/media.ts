import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Notetaker recordings live in our Cloudflare R2 bucket (written by the
// worker's media-copy thread). The bucket is private; the browser only ever gets
// a short-lived signed link, issued after the meeting access check.

const SIGNED_URL_TTL_SECONDS = 60 * 60

let client: S3Client | null = null

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: 'auto',   // R2 has no regions; the SDK just needs a value
      endpoint: process.env.MEDIA_R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.MEDIA_R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.MEDIA_R2_SECRET_ACCESS_KEY!,
      },
    })
  }
  return client
}

export function mediaConfigured(): boolean {
  return Boolean(process.env.MEDIA_R2_BUCKET)
}

export async function signedRecordingUrl(key: string): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: process.env.MEDIA_R2_BUCKET, Key: key }),
    { expiresIn: SIGNED_URL_TTL_SECONDS }
  )
}
