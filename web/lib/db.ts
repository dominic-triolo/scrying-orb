import { Pool } from 'pg'

// Singleton pool — reused across requests in the same process
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export interface Meeting {
  id: string
  meeting_name: string
  meeting_datetime: string | null
  meeting_type: string | null
  meeting_type_source: string | null
  meeting_outcome: string | null
  recording_owner: string | null
  rep_talk_pct: number | null
  prospect_talk_pct: number | null
  attendees: string[]
  status: string | null
  import_source: string | null
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
  // meeting_outcome inherited from Meeting
}

interface GetMeetingsOptions {
  repEmail?: string   // if set, restrict to this rep's meetings (non-leadership, or "mine")
  q?: string          // free text: matches meeting title OR an attendee email
  type?: string       // meeting_type filter
  dateFrom?: string   // 'YYYY-MM-DD' inclusive lower bound
  dateTo?: string     // 'YYYY-MM-DD' inclusive upper bound (whole day)
  limit?: number      // page size (default 60, capped at 200)
  offset?: number     // page offset
}

export interface MeetingsPage {
  meetings: Meeting[]
  total: number       // total matching the filters, across all pages
}

/**
 * Search + paginate meetings server-side. The backfill put ~7k meetings in the
 * table, so filtering has to happen in SQL — the old client-side filter only saw
 * the first page and couldn't find anything beyond it. `count(*) OVER()` returns
 * the full match count (pre-LIMIT) so the UI can paginate.
 */
export async function getMeetings(opts: GetMeetingsOptions = {}): Promise<MeetingsPage> {
  const { repEmail, type, dateFrom, dateTo } = opts
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)
  const like = opts.q && opts.q.trim() ? `%${opts.q.trim()}%` : null

  const { rows } = await pool.query(
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
      m.meeting_outcome,
      m.status,
      m.import_source,
      COALESCE(
        array_agg(mc.email ORDER BY mc.email) FILTER (WHERE mc.email IS NOT NULL),
        '{}'
      ) AS attendees,
      count(*) OVER() AS total_count
    FROM meetings m
    LEFT JOIN meeting_contacts mc ON mc.meeting_id = m.id
    WHERE m.status IN ('complete', 'pending_synthesis', 'no_show', 'legacy')
      AND ($1::text IS NULL OR m.recording_owner = $1)
      AND ($2::text IS NULL OR m.meeting_type = $2)
      AND ($3::date IS NULL OR m.meeting_datetime >= $3::date)
      AND ($4::date IS NULL OR m.meeting_datetime < ($4::date + INTERVAL '1 day'))
      AND ($5::text IS NULL
           OR m.meeting_name ILIKE $5
           OR EXISTS (SELECT 1 FROM meeting_contacts mc2
                      WHERE mc2.meeting_id = m.id AND mc2.email ILIKE $5))
    GROUP BY m.id
    ORDER BY m.meeting_datetime DESC NULLS LAST
    LIMIT $6 OFFSET $7
    `,
    [repEmail ?? null, type ?? null, dateFrom ?? null, dateTo ?? null, like, limit, offset]
  )

  const total = rows.length ? Number(rows[0].total_count) : 0
  const meetings: Meeting[] = rows.map((r) => {
    const m = { ...r }
    delete m.total_count   // window-count helper column, not part of Meeting
    return m as Meeting
  })
  return { meetings, total }
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
      m.meeting_outcome,
      m.status,
      m.import_source,
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

/**
 * Persist an on-demand synthesis result and mark the meeting complete.
 * Used by the legacy-meeting "Analyze" flow (web /api/meetings/[id]/synthesize).
 */
export async function completeSynthesis(
  id: string,
  synthesis: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `
    UPDATE meetings
    SET synthesis_output = $2,
        status           = 'complete',
        synthesized_at   = NOW()
    WHERE id = $1
    `,
    [id, JSON.stringify(synthesis)]
  )
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

// ── Meeting type config ───────────────────────────────────────────────────────

export interface MeetingTypeConfig {
  id: string
  label: string
  scoreable: boolean
  sort_order: number
}

export async function getMeetingTypes(): Promise<MeetingTypeConfig[]> {
  const { rows } = await pool.query<MeetingTypeConfig>(
    'SELECT id, label, scoreable, sort_order FROM meeting_types ORDER BY sort_order ASC, id ASC'
  )
  return rows
}

export async function upsertMeetingType(t: MeetingTypeConfig): Promise<void> {
  await pool.query(
    `INSERT INTO meeting_types (id, label, scoreable, sort_order, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE SET
       label      = EXCLUDED.label,
       scoreable  = EXCLUDED.scoreable,
       sort_order = EXCLUDED.sort_order,
       updated_at = NOW()`,
    [t.id, t.label, t.scoreable, t.sort_order]
  )
}

export async function deleteMeetingType(id: string): Promise<void> {
  await pool.query('DELETE FROM meeting_types WHERE id = $1', [id])
}

// ── Meeting type (per-meeting update) ────────────────────────────────────────

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

// ── Cross-transcript analysis (migration 010) ───────────────────────────────

export interface AnalysisFilters {
  meeting_types: string[]
  reps: string[]
  date_from: string | null
  date_to: string | null
}

export interface AnalysisJob {
  id: string
  created_by: string
  query: string
  filters: AnalysisFilters
  status: 'queued' | 'running' | 'complete' | 'error' | 'canceled'
  total_transcripts: number
  processed_count: number
  result: Record<string, unknown> | null
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface AnalysisMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

// The analyzable set: a stored transcript for a call that actually happened.
// MUST stay identical to synthesis/db.py:_ANALYZABLE_WHERE so the estimated
// count the user confirms equals what the worker processes.
const ANALYZABLE = `transcript_text IS NOT NULL AND status IN ('complete', 'legacy')`

// $1 meeting_types[], $2 reps[], $3 date_from, $4 date_to — null ⇒ no filter.
const FILTER_WHERE = `
  AND ($1::text[] IS NULL OR meeting_type    = ANY($1))
  AND ($2::text[] IS NULL OR recording_owner = ANY($2))
  AND ($3::date   IS NULL OR meeting_datetime >= $3::date)
  AND ($4::date   IS NULL OR meeting_datetime <  ($4::date + INTERVAL '1 day'))
`

function filterParams(f: AnalysisFilters) {
  return [
    f.meeting_types.length ? f.meeting_types : null,
    f.reps.length ? f.reps : null,
    f.date_from || null,
    f.date_to || null,
  ]
}

/** Distinct reps (recording_owner) that have at least one analyzable transcript. */
export async function listAnalysisReps(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT recording_owner FROM meetings
     WHERE recording_owner IS NOT NULL AND ${ANALYZABLE}
     ORDER BY recording_owner`
  )
  return rows.map((r) => r.recording_owner)
}

/** How many transcripts match these filters (the estimate + the run size). */
export async function countAnalyzableTranscripts(f: AnalysisFilters): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM meetings WHERE ${ANALYZABLE} ${FILTER_WHERE}`,
    filterParams(f)
  )
  return rows[0]?.n ?? 0
}

export async function createAnalysisJob(
  createdBy: string,
  query: string,
  filters: AnalysisFilters,
  total: number
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO analysis_jobs (created_by, query, filters, total_transcripts)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [createdBy, query, JSON.stringify(filters), total]
  )
  return rows[0].id
}

const JOB_COLUMNS = `id, created_by, query, filters, status, total_transcripts,
  processed_count, result, error, created_at, started_at, finished_at`

export async function getAnalysisJob(id: string): Promise<AnalysisJob | null> {
  const { rows } = await pool.query(
    `SELECT ${JOB_COLUMNS} FROM analysis_jobs WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

export async function listAnalysisJobs(limit = 25): Promise<AnalysisJob[]> {
  const { rows } = await pool.query(
    `SELECT ${JOB_COLUMNS} FROM analysis_jobs ORDER BY created_at DESC LIMIT $1`,
    [limit]
  )
  return rows
}

/** Flip a queued/running job to canceled. Returns false if it was already terminal. */
export async function cancelAnalysisJob(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE analysis_jobs SET status = 'canceled', finished_at = NOW()
     WHERE id = $1 AND status IN ('queued', 'running')`,
    [id]
  )
  return (rowCount ?? 0) > 0
}

export async function getAnalysisMessages(jobId: string): Promise<AnalysisMessage[]> {
  const { rows } = await pool.query(
    `SELECT id, role, content, created_at FROM analysis_messages
     WHERE job_id = $1 ORDER BY created_at ASC`,
    [jobId]
  )
  return rows
}

export async function addAnalysisMessage(
  jobId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  await pool.query(
    `INSERT INTO analysis_messages (job_id, role, content) VALUES ($1, $2, $3)`,
    [jobId, role, content]
  )
}

export interface FindingSample {
  recording_owner: string | null
  meeting_name: string
  findings: Record<string, unknown>
}

/** A bounded sample of per-transcript findings, for grounding the chat follow-ups. */
export async function getAnalysisFindingSample(
  jobId: string,
  limit = 60
): Promise<FindingSample[]> {
  const { rows } = await pool.query(
    `SELECT m.recording_owner, m.meeting_name, f.findings
     FROM analysis_findings f JOIN meetings m ON m.id = f.meeting_id
     WHERE f.job_id = $1 AND f.error IS NULL
     LIMIT $2`,
    [jobId, limit]
  )
  return rows
}
