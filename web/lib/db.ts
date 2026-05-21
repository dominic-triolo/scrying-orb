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
  status: string | null
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
      m.status,
      COALESCE(
        array_agg(mc.email ORDER BY mc.email) FILTER (WHERE mc.email IS NOT NULL),
        '{}'
      ) AS attendees
    FROM meetings m
    LEFT JOIN meeting_contacts mc ON mc.meeting_id = m.id
    WHERE m.status IN ('complete', 'pending_synthesis')
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

// ── Scoring ───────────────────────────────────────────────────────────────────

export interface ScorecardSection {
  id: string
  scorecard_id: string
  title: string
  description_min: string | null
  description_mid: string | null
  description_max: string | null
  weight: number | null
  sort_order: number
}

export interface Scorecard {
  id: string
  meeting_type: string
  min_score: number
  mid_score: number
  max_score: number
  formatting_prompt: string | null
  sections: ScorecardSection[]
}

export interface SectionScore {
  section_id: string
  title: string
  score: number
  reasoning: string
}

export interface MeetingScore {
  id: string
  meeting_id: string
  section_scores: SectionScore[]
  overall_score: number | null
  coaching_output: string | null
  max_score: number
  created_at: string
}

export async function getScorecard(meetingType: string): Promise<Scorecard | null> {
  const { rows: cards } = await pool.query<Omit<Scorecard, 'sections'>>(
    'SELECT id, meeting_type, min_score, mid_score, max_score, formatting_prompt FROM scorecards WHERE meeting_type = $1',
    [meetingType]
  )
  if (!cards[0]) return null
  const card = cards[0]
  const { rows: sections } = await pool.query<ScorecardSection>(
    'SELECT id, scorecard_id, title, description_min, description_mid, description_max, weight, sort_order FROM scorecard_sections WHERE scorecard_id = $1 ORDER BY sort_order ASC',
    [card.id]
  )
  return { ...card, sections }
}

export async function getAllScorecards(): Promise<Scorecard[]> {
  const { rows: cards } = await pool.query<Omit<Scorecard, 'sections'>>(
    'SELECT id, meeting_type, min_score, mid_score, max_score, formatting_prompt FROM scorecards ORDER BY meeting_type'
  )
  if (cards.length === 0) return []
  const ids = cards.map((c) => c.id)
  const { rows: sections } = await pool.query<ScorecardSection>(
    `SELECT id, scorecard_id, title, description_min, description_mid, description_max, weight, sort_order
     FROM scorecard_sections WHERE scorecard_id = ANY($1) ORDER BY sort_order ASC`,
    [ids]
  )
  return cards.map((card) => ({
    ...card,
    sections: sections.filter((s) => s.scorecard_id === card.id),
  }))
}

export async function upsertScorecard(
  meetingType: string,
  data: {
    min_score: number
    mid_score: number
    max_score: number
    formatting_prompt: string | null
    sections: Array<{
      title: string
      description_min: string | null
      description_mid: string | null
      description_max: string | null
      weight: number | null
      sort_order: number
    }>
  }
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Upsert scorecard
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO scorecards (meeting_type, min_score, mid_score, max_score, formatting_prompt, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (meeting_type) DO UPDATE SET
         min_score         = EXCLUDED.min_score,
         mid_score         = EXCLUDED.mid_score,
         max_score         = EXCLUDED.max_score,
         formatting_prompt = EXCLUDED.formatting_prompt,
         updated_at        = NOW()
       RETURNING id`,
      [meetingType, data.min_score, data.mid_score, data.max_score, data.formatting_prompt]
    )
    const scorecardId = rows[0].id
    // Replace sections atomically
    await client.query('DELETE FROM scorecard_sections WHERE scorecard_id = $1', [scorecardId])
    for (const s of data.sections) {
      await client.query(
        `INSERT INTO scorecard_sections
           (scorecard_id, title, description_min, description_mid, description_max, weight, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [scorecardId, s.title, s.description_min, s.description_mid, s.description_max, s.weight, s.sort_order]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getMeetingScore(meetingId: string): Promise<MeetingScore | null> {
  const { rows } = await pool.query<MeetingScore>(
    `SELECT ms.id, ms.meeting_id, ms.section_scores,
            ms.overall_score::float  AS overall_score,
            ms.max_score::float      AS max_score,
            ms.coaching_output, ms.created_at,
            m.rep_talk_pct::float    AS rep_talk_pct,
            m.prospect_talk_pct::float AS prospect_talk_pct
     FROM meeting_scores ms
     JOIN meetings m ON m.id = ms.meeting_id
     WHERE ms.meeting_id = $1`,
    [meetingId]
  )
  return rows[0] ?? null
}

export async function saveMeetingScore(
  meetingId: string,
  data: {
    section_scores: SectionScore[]
    overall_score: number
    coaching_output: string
    max_score: number
    rep_talk_pct: number | null
    prospect_talk_pct: number | null
  }
): Promise<MeetingScore> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Store talk ratio on meetings table (columns already exist)
    if (data.rep_talk_pct !== null && data.prospect_talk_pct !== null) {
      await client.query(
        'UPDATE meetings SET rep_talk_pct = $1, prospect_talk_pct = $2 WHERE id = $3',
        [data.rep_talk_pct, data.prospect_talk_pct, meetingId]
      )
    }
    const { rows } = await client.query<MeetingScore>(
      `INSERT INTO meeting_scores (meeting_id, section_scores, overall_score, coaching_output, max_score)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (meeting_id) DO UPDATE SET
         section_scores  = EXCLUDED.section_scores,
         overall_score   = EXCLUDED.overall_score,
         coaching_output = EXCLUDED.coaching_output,
         max_score       = EXCLUDED.max_score,
         updated_at      = NOW()
       RETURNING *`,
      [meetingId, JSON.stringify(data.section_scores), data.overall_score, data.coaching_output, data.max_score]
    )
    await client.query('COMMIT')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
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
