import { Pool } from 'pg'

// Singleton pool — reused across requests in the same process
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export interface Meeting {
  id: string
  meeting_name: string
  meeting_datetime: string | null
  meeting_type: string | null
  meeting_type_source: string | null
  recording_owner: string | null
  rep_talk_pct: number | null
  prospect_talk_pct: number | null
  attendees: string[]
}

export interface Deal {
  id: string
  name: string
  stage: string
  pipeline: string
}

export interface Contact {
  email: string
  hubspot_contact_id: string | null
  deals: Deal[]
}

export interface MeetingDetail extends Meeting {
  recording_file_id: string | null
  transcript_copy_id: string | null
  synthesis_output: Record<string, unknown> | null
  transcript_text: string | null
  notes: string | null
  hubspot_deal_id: string | null
  contacts: Contact[]
}

interface GetMeetingsOptions {
  repEmail?: string // if set, filter to only this rep's meetings
}

export async function getMeetings({ repEmail }: GetMeetingsOptions = {}): Promise<Meeting[]> {
  const { rows } = await pool.query<Meeting>(
    `
    SELECT
      m.id,
      m.meeting_name,
      m.meeting_datetime,
      m.meeting_type,
      m.meeting_type_source,
      m.recording_owner,
      m.rep_talk_pct,
      m.prospect_talk_pct,
      COALESCE(
        array_agg(mc.email ORDER BY mc.email) FILTER (WHERE mc.email IS NOT NULL),
        '{}'
      ) AS attendees
    FROM meetings m
    LEFT JOIN meeting_contacts mc ON mc.meeting_id = m.id
    WHERE m.status = 'complete'
      AND ($1::text IS NULL OR m.recording_owner = $1)
    GROUP BY m.id
    ORDER BY m.meeting_datetime DESC NULLS LAST
    LIMIT 200
    `,
    [repEmail ?? null]
  )
  return rows
}

export async function getMeetingById(id: string): Promise<MeetingDetail | null> {
  const { rows } = await pool.query(
    `
    SELECT
      m.id,
      m.meeting_name,
      m.meeting_datetime,
      m.meeting_type,
      m.meeting_type_source,
      m.recording_owner,
      m.recording_file_id,
      m.transcript_copy_id,
      m.rep_talk_pct,
      m.prospect_talk_pct,
      m.synthesis_output,
      m.transcript_text,
      m.notes,
      m.hubspot_deal_id,
      COALESCE(
        json_agg(
          json_build_object(
            'email', mc.email,
            'hubspot_contact_id', mc.hubspot_contact_id,
            'deals', COALESCE(mc.deals, '[]'::jsonb)
          )
        ) FILTER (WHERE mc.email IS NOT NULL),
        '[]'
      ) AS contacts
    FROM meetings m
    LEFT JOIN meeting_contacts mc ON mc.meeting_id = m.id
    WHERE m.id = $1
    GROUP BY m.id
    `,
    [id]
  )
  return rows[0] ?? null
}

// ── Templates ────────────────────────────────────────────────────────────────

export interface Template {
  meeting_type: string
  note_example: string | null
  email_subject_example: string | null
  email_body_example: string | null
}

export interface ApprovedLink {
  id: string
  url: string
  label: string
}

export async function getTemplates(): Promise<Template[]> {
  const { rows } = await pool.query<Template>(
    'SELECT meeting_type, note_example, email_subject_example, email_body_example FROM meeting_templates'
  )
  return rows
}

export async function getTemplate(meetingType: string): Promise<Template | null> {
  const { rows } = await pool.query<Template>(
    'SELECT meeting_type, note_example, email_subject_example, email_body_example FROM meeting_templates WHERE meeting_type = $1',
    [meetingType]
  )
  return rows[0] ?? null
}

export async function upsertTemplate(t: Template): Promise<void> {
  await pool.query(
    `INSERT INTO meeting_templates (meeting_type, note_example, email_subject_example, email_body_example, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (meeting_type) DO UPDATE SET
       note_example          = EXCLUDED.note_example,
       email_subject_example = EXCLUDED.email_subject_example,
       email_body_example    = EXCLUDED.email_body_example,
       updated_at            = NOW()`,
    [t.meeting_type, t.note_example, t.email_subject_example, t.email_body_example]
  )
}

export async function getApprovedLinks(): Promise<ApprovedLink[]> {
  const { rows } = await pool.query<ApprovedLink>(
    'SELECT id, url, label FROM approved_links ORDER BY created_at ASC'
  )
  return rows
}

export async function addApprovedLink(url: string, label: string): Promise<ApprovedLink> {
  const { rows } = await pool.query<ApprovedLink>(
    'INSERT INTO approved_links (url, label) VALUES ($1, $2) RETURNING id, url, label',
    [url, label]
  )
  return rows[0]
}

export async function deleteApprovedLink(id: string): Promise<void> {
  await pool.query('DELETE FROM approved_links WHERE id = $1', [id])
}

// ── Meeting type ──────────────────────────────────────────────────────────────

export async function updateMeetingType(
  id: string,
  meetingType: string
): Promise<void> {
  await pool.query(
    `
    UPDATE meetings
    SET
      meeting_type        = $2,
      meeting_type_source = 'manual',
      status              = 'pending_synthesis',
      synthesis_output    = NULL,
      synthesized_at      = NULL
    WHERE id = $1
    `,
    [id, meetingType]
  )
}
