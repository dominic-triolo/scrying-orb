// Meeting Transcript Mover
// Run as: meetingbot Google account
// Trigger: Time-driven, every 15 minutes
//
// What it does:
//   - Scans all Drive folders shared with meetingbot
//   - Finds meeting transcript docs (Google Docs with a date in the filename)
//     and meeting recordings (video files with a date in the filename)
//   - No longer relies on filename suffixes — works with any naming Google uses
//   - Looks up the Google Calendar event by meeting name to get attendees
//   - Skips meetings with no external participants (@trovatrip.com only)
//   - Matches each transcript to its recording using the shared filename prefix
//   - Copies the transcript into the 'Shared Meetings' shared Drive
//   - Logs file IDs, metadata, and external participant emails to a Google Sheet

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
const CONFIG = {
  // ID of the 'Shared Meetings' shared Drive folder
  SHARED_DRIVE_ID: '0AN13MFWJTeU4Uk9PVA',

  // ID of the Google Sheet where processed meeting records will be logged
  LOG_SHEET_ID: '1N7rwu3gtePKxe_QIFCLuGd0mavwoU59PPZKRUeF9hqg',

  // Name of the tab inside that sheet to write records to
  LOG_SHEET_TAB: 'Meetings',

  // How far back to look for new Drive files on each run (minutes)
  // Set slightly above your trigger interval to avoid gaps
  LOOKBACK_MINUTES: 20,

  // How many days either side of the file date to search for the Calendar event
  CALENDAR_SEARCH_WINDOW_DAYS: 2,

  // Internal domain — attendees with this domain are treated as internal
  INTERNAL_DOMAIN: 'trovatrip.com',
};

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

const GOOGLE_DOC_MIME  = 'application/vnd.google-apps.document';
const VIDEO_MIME_PREFIX = 'video/';

// Date pattern that all Google Meet files include in their name:
//   "Meeting Name - 2025/01/15 10:30 PST ..."
const DATE_PATTERN = /\d{4}\/\d{2}\/\d{2}/;

// ---------------------------------------------------------------------------
// Filename parsing
// ---------------------------------------------------------------------------

/**
 * Extracts a pairing key from any Meet-generated filename by finding the
 * date/time portion and returning everything up to the end of the time token.
 *
 * Works regardless of what suffix Google appends after the time:
 *   "Project Sync - 2025/01/15 10:30 PST - Notes by Gemini"  → "Project Sync - 2025/01/15 10:30 PST"
 *   "Project Sync - 2025/01/15 10:30 PST - Gemini notes"     → "Project Sync - 2025/01/15 10:30 PST"
 *   "Project Sync - 2025/01/15 10:30 PST - Recording"        → "Project Sync - 2025/01/15 10:30 PST"
 *   "Project Sync - 2025/01/15 10:30 PST"                    → "Project Sync - 2025/01/15 10:30 PST"
 *
 * Returns null if no date pattern is found (i.e. not a Meet file).
 */
function extractPairingKey(filename) {
  // Capture everything up to and including HH:MM, but deliberately exclude
  // any trailing timezone token (PST, GMT, UTC, etc.) so that transcript and
  // recording filenames always normalize to the same key regardless of whether
  // Google appended a timezone to one but not the other.
  //
  // "Project Sync - 2025/06/10 14:30 PST - Notes by Gemini"  → "Project Sync - 2025/06/10 14:30"
  // "Project Sync - 2025/06/10 14:30 - Recording"            → "Project Sync - 2025/06/10 14:30"
  // "Project Sync - 2025/06/10 14:30"                        → "Project Sync - 2025/06/10 14:30"
  const match = filename.match(/^(.+?\d{4}\/\d{2}\/\d{2}(?:\s+\d{2}:\d{2})?)/);
  return match ? match[1].trim() : null;
}

/**
 * Returns true if this file looks like a Meet transcript:
 *   - Google Doc MIME type
 *   - Filename contains a date pattern (YYYY/MM/DD)
 */
function isTranscriptCandidate(file) {
  return file.getMimeType() === GOOGLE_DOC_MIME &&
         DATE_PATTERN.test(file.getName());
}

/**
 * Returns true if this file looks like a Meet recording:
 *   - Video MIME type
 *   - Filename contains a date pattern (YYYY/MM/DD)
 */
function isRecordingCandidate(file) {
  return file.getMimeType().startsWith(VIDEO_MIME_PREFIX) &&
         DATE_PATTERN.test(file.getName());
}

/**
 * Extracts the meeting name from the pairing key —
 * everything before the first ' - YYYY/' pattern.
 *
 * "Project Sync - 2025/01/15 10:30 PST" → "Project Sync"
 */
function parseMeetingName(pairingKey) {
  const match = pairingKey.match(/^(.+?)\s+-\s+\d{4}\//);
  return match ? match[1].trim() : pairingKey;
}

/**
 * Extracts an approximate meeting date (date only, no time) from the pairing key.
 * Returns a Date object or null.
 */
function parseMeetingDate(pairingKey) {
  const match = pairingKey.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(`${year}-${month}-${day}T00:00:00`);
}

/**
 * Parses a full meeting datetime from the pairing key.
 * Returns an ISO string or null.
 */
function parseMeetingDatetime(pairingKey) {
  const match = pairingKey.match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:00`).toISOString();
}

// ---------------------------------------------------------------------------
// Calendar lookup
// ---------------------------------------------------------------------------

/**
 * Searches all calendars visible to meetingbot for an event whose title
 * matches meetingName, within a window around approximateDate.
 *
 * Returns the first matching CalendarEvent, or null if not found.
 */
function findCalendarEvent(meetingName, approximateDate) {
  const windowDays = CONFIG.CALENDAR_SEARCH_WINDOW_DAYS;

  const start = new Date(approximateDate);
  start.setDate(start.getDate() - windowDays);

  const end = new Date(approximateDate);
  end.setDate(end.getDate() + windowDays);

  const calendars = CalendarApp.getAllCalendars();

  for (const calendar of calendars) {
    const events = calendar.getEvents(start, end);
    for (const event of events) {
      if (event.getTitle().toLowerCase() === meetingName.toLowerCase()) {
        Logger.log(`Calendar match: "${event.getTitle()}" at ${event.getStartTime()} on ${calendar.getName()}`);
        return event;
      }
    }
  }

  Logger.log(`No calendar event found for: "${meetingName}" around ${approximateDate}`);
  return null;
}

/**
 * Returns external attendee emails from a CalendarEvent —
 * anyone not on @trovatrip.com.
 */
function getExternalAttendees(event) {
  const guests = event.getGuestList(true); // true = include all guests
  const external = guests
    .map(g => g.getEmail())
    .filter(email => !email.toLowerCase().endsWith(`@${CONFIG.INTERNAL_DOMAIN}`));

  Logger.log(`External attendees: ${external.length > 0 ? external.join(', ') : 'none'}`);
  return external;
}

// ---------------------------------------------------------------------------
// Drive helpers
// ---------------------------------------------------------------------------

/**
 * Returns all Drive folders shared with meetingbot (not owned by meetingbot).
 */
function getSharedFolders() {
  const folders = [];
  const result = DriveApp.searchFolders('"me" in readers or "me" in writers');
  while (result.hasNext()) {
    const folder = result.next();
    if (folder.getOwner() && folder.getOwner().getEmail() === Session.getActiveUser().getEmail()) {
      continue;
    }
    folders.push(folder);
  }
  return folders;
}

/**
 * Returns files created within the lookback window inside a given folder.
 */
function getRecentFiles(folder, lookbackMs) {
  const files = [];
  const cutoff = new Date(Date.now() - lookbackMs);
  const result = folder.getFiles();
  while (result.hasNext()) {
    const file = result.next();
    if (file.getDateCreated() >= cutoff) {
      files.push(file);
    }
  }
  return files;
}

/**
 * Copies a transcript file into the Shared Meetings folder.
 * Returns the new file's ID.
 */
function copyToSharedDrive(file) {
  const sharedDriveFolder = DriveApp.getFolderById(CONFIG.SHARED_DRIVE_ID);
  const copy = file.makeCopy(file.getName(), sharedDriveFolder);
  return copy.getId();
}

// ---------------------------------------------------------------------------
// Sheet logging
// ---------------------------------------------------------------------------

function ensureSheetHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'processed_at',        // ISO timestamp of when the script ran
      'meeting_name',        // Parsed from filename
      'meeting_datetime',    // Parsed from filename
      'pairing_key',         // Full shared prefix — used for deduplication
      'transcript_copy_id',  // File ID of the copy in Shared Meetings
      'recording_file_id',   // File ID of the original recording in rep's Drive
      'recording_owner',     // Email of the rep who owns the recording
      'external_attendees',  // Comma-separated external participant emails
      'status',              // 'pending_synthesis' | 'skipped_internal' | 'error'
      'notes',               // Skip reasons or error details
    ]);
    sheet.setFrozenRows(1);
  }
}

function alreadyProcessed(sheet, pairingKey) {
  const data = sheet.getDataRange().getValues();
  // Column index 3 = pairing_key (0-indexed)
  return data.slice(1).some(row => row[3] === pairingKey);
}

function logRecord(sheet, record) {
  sheet.appendRow([
    record.processedAt,
    record.meetingName,
    record.meetingDatetime,
    record.pairingKey,
    record.transcriptCopyId,
    record.recordingFileId,
    record.recordingOwner,
    record.externalAttendees,
    record.status,
    record.notes,
  ]);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function processNewTranscripts() {
  const lookbackMs = CONFIG.LOOKBACK_MINUTES * 60 * 1000;

  const logSpreadsheet = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID);
  let sheet = logSpreadsheet.getSheetByName(CONFIG.LOG_SHEET_TAB);
  if (!sheet) {
    sheet = logSpreadsheet.insertSheet(CONFIG.LOG_SHEET_TAB);
  }
  ensureSheetHeaders(sheet);

  const sharedFolders = getSharedFolders();
  Logger.log(`Found ${sharedFolders.length} shared folder(s) to scan`);

  for (const folder of sharedFolders) {
    const recentFiles = getRecentFiles(folder, lookbackMs);

    // Build a map of pairingKey → recording file for this folder
    const recordingMap = {};
    for (const file of recentFiles) {
      if (!isRecordingCandidate(file)) continue;
      const key = extractPairingKey(file.getName());
      if (key) recordingMap[key] = file;
    }

    // Process transcript candidates only
    for (const file of recentFiles) {
      if (!isTranscriptCandidate(file)) continue;

      const pairingKey = extractPairingKey(file.getName());
      if (!pairingKey) continue;

      if (alreadyProcessed(sheet, pairingKey)) {
        Logger.log(`Already processed: ${pairingKey}`);
        continue;
      }

      const meetingName     = parseMeetingName(pairingKey);
      const meetingDate     = parseMeetingDate(pairingKey);
      const meetingDatetime = parseMeetingDatetime(pairingKey);

      const record = {
        processedAt:       new Date().toISOString(),
        meetingName:       meetingName,
        meetingDatetime:   meetingDatetime,
        pairingKey:        pairingKey,
        transcriptCopyId:  null,
        recordingFileId:   null,
        recordingOwner:    folder.getOwner() ? folder.getOwner().getEmail() : null,
        externalAttendees: null,
        status:            'pending_synthesis',
        notes:             '',
      };

      try {
        // --- Calendar lookup & external attendee check ---
        const calEvent = findCalendarEvent(meetingName, meetingDate);

        if (!calEvent) {
          // No matching calendar event — log a warning but still process.
          // This happens if reps haven't shared their calendar with meetingbot yet.
          record.notes = 'Calendar event not found — external attendees unverified';
          Logger.log(`Warning: no calendar event found for "${meetingName}", processing without attendee check`);
        } else {
          const externalAttendees = getExternalAttendees(calEvent);

          if (externalAttendees.length === 0) {
            // Internal-only meeting — skip
            record.status = 'skipped_internal';
            record.notes  = 'No external attendees — skipped';
            Logger.log(`Skipping internal-only meeting: "${meetingName}"`);
            logRecord(sheet, record);
            continue;
          }

          record.externalAttendees = externalAttendees.join(', ');
        }

        // --- Copy transcript to Shared Meetings ---
        record.transcriptCopyId = copyToSharedDrive(file);
        Logger.log(`Copied transcript: "${file.getName()}" → ${record.transcriptCopyId}`);

        // --- Match recording ---
        // First try the lookback window (fast path). If not found, fall back to
        // searching the whole folder by pairing key prefix.
        let recording = recordingMap[pairingKey];

        if (!recording) {
          // Fallback: search for any video file whose name starts with the pairing key
          const allFiles = folder.getFiles();
          while (allFiles.hasNext()) {
            const f = allFiles.next();
            if (isRecordingCandidate(f) && extractPairingKey(f.getName()) === pairingKey) {
              recording = f;
              Logger.log(`Matched recording via fallback search: "${f.getName()}"`);
              break;
            }
          }
        }

        if (recording) {
          record.recordingFileId = recording.getId();
          if (recording.getOwner()) {
            record.recordingOwner = recording.getOwner().getEmail();
          }
          Logger.log(`Recording file ID: ${record.recordingFileId}`);

          // Share the recording with the whole org so it's viewable in the orb UI
          // (the meeting detail page embeds it via drive.google.com/file/d/<id>/preview).
          try {
            recording.setSharing(DriveApp.Access.DOMAIN, DriveApp.Permission.VIEW);
            Logger.log(`Shared recording with domain: "${recording.getName()}"`);
          } catch (shareErr) {
            // meetingbot may only have view access — log and continue
            Logger.log(`Could not share recording (insufficient permissions?): ${shareErr.message}`);
          }
        } else {
          record.notes = (record.notes ? record.notes + ' | ' : '') + 'Recording not found';
          Logger.log(`No recording match for: "${meetingName}"`);
        }

      } catch (err) {
        record.status = 'error';
        record.notes  = err.message;
        Logger.log(`Error processing "${file.getName()}": ${err.message}`);
      }

      logRecord(sheet, record);
    }
  }

  Logger.log('processNewTranscripts complete');
}

// ---------------------------------------------------------------------------
// One-time setup — run manually once after updating CONFIG
// ---------------------------------------------------------------------------

function initSetup() {
  Logger.log('--- initSetup ---');

  try {
    const folder = DriveApp.getFolderById(CONFIG.SHARED_DRIVE_ID);
    Logger.log(`✓ Shared Meetings folder: "${folder.getName()}"`);
  } catch (e) {
    Logger.log(`✗ Cannot access Shared Meetings folder: ${e.message}`);
  }

  try {
    const ss = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID);
    Logger.log(`✓ Log sheet: "${ss.getName()}"`);
  } catch (e) {
    Logger.log(`✗ Cannot access log sheet: ${e.message}`);
  }

  try {
    const calendars = CalendarApp.getAllCalendars();
    Logger.log(`✓ Calendars visible to meetingbot: ${calendars.length}`);
    calendars.forEach(c => Logger.log(`  - ${c.getName()} (${c.getId()})`));
  } catch (e) {
    Logger.log(`✗ Calendar access error: ${e.message}`);
  }

  const folders = getSharedFolders();
  Logger.log(`✓ Shared Drive folders visible: ${folders.length}`);
  folders.forEach(f => Logger.log(`  - ${f.getName()}`));

  Logger.log('--- initSetup complete ---');
}

// ---------------------------------------------------------------------------
// Trigger installer — run once
// ---------------------------------------------------------------------------

function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processNewTranscripts')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('processNewTranscripts')
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log('✓ 15-minute trigger installed for processNewTranscripts');
}

// ---------------------------------------------------------------------------
// One-off backfill — recover transcripts the mover missed
// ---------------------------------------------------------------------------
//
// processNewTranscripts only looks at files created in the last LOOKBACK_MINUTES.
// Any transcript that aged past that window before being processed (e.g. every
// meeting dropped while the mover was keyed to the old '- Notes by Gemini' suffix)
// is invisible to it forever. This scans ALL transcript candidates in the shared
// folders, ignoring the lookback, and logs any not already in the sheet.
//
// Safe + idempotent: dedupes on pairing_key (normalized so old rows that kept a
// timezone token still match). Re-run until it logs 0 — Apps Script's ~6-min limit
// means a large backfill needs several passes; each pass skips what's already done.
//
// BACKFILL_SINCE bounds it to the affected period so you don't resurrect ancient
// meetings into nurture. Set it to the earliest meeting date you want to recover.

const BACKFILL_SINCE = '2026-07-01';   // YYYY-MM-DD — adjust before running

/** Normalize a pairing key to the timezone-less form the current parser produces,
 *  so keys logged by the old (suffix-based) mover still dedupe. */
function normalizePairingKey(k) {
  const m = String(k).match(/^(.+?\d{4}\/\d{2}\/\d{2}(?:\s+\d{2}:\d{2})?)/);
  return m ? m[1].trim() : String(k);
}

function backfillAllTranscripts() {
  const sheet = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID).getSheetByName(CONFIG.LOG_SHEET_TAB);
  ensureSheetHeaders(sheet);

  // Pre-load every existing pairing_key ONCE (column D), normalized — far faster
  // than re-scanning the sheet per file, and tolerant of the old key format.
  const lastRow = sheet.getLastRow();
  const done = new Set(
    (lastRow > 1 ? sheet.getRange(2, 4, lastRow - 1, 1).getValues() : [])
      .map(r => normalizePairingKey(r[0])).filter(Boolean)
  );

  const since = new Date(`${BACKFILL_SINCE}T00:00:00`);
  const start = Date.now();
  const MAX_MS = 5 * 60 * 1000;   // stop before the 6-min limit; re-run to continue
  let logged = 0, skipped = 0, tooOld = 0, timedOut = false;

  for (const folder of getSharedFolders()) {
    const owner = folder.getOwner() ? folder.getOwner().getEmail() : null;
    const recordingByKey = {};
    const transcripts = [];
    const it = folder.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      const key = extractPairingKey(f.getName());
      if (!key) continue;
      if (isRecordingCandidate(f)) recordingByKey[key] = f;
      else if (isTranscriptCandidate(f)) transcripts.push({ f, key });
    }

    for (const { f, key } of transcripts) {
      if (done.has(key)) { skipped++; continue; }
      const mDate = parseMeetingDate(key);
      if (mDate && mDate < since) { tooOld++; continue; }
      if (Date.now() - start > MAX_MS) { timedOut = true; break; }

      const meetingName = parseMeetingName(key);
      const record = {
        processedAt: new Date().toISOString(), meetingName,
        meetingDatetime: parseMeetingDatetime(key), pairingKey: key,
        transcriptCopyId: null, recordingFileId: null, recordingOwner: owner,
        externalAttendees: null, status: 'pending_synthesis', notes: 'backfill',
      };
      try {
        const cal = findCalendarEvent(meetingName, mDate);
        if (cal) {
          const ext = getExternalAttendees(cal);
          if (ext.length === 0) {
            record.status = 'skipped_internal';
            record.notes = 'No external attendees — skipped';
            logRecord(sheet, record); done.add(key); continue;
          }
          record.externalAttendees = ext.join(', ');
        } else {
          record.notes = 'Calendar event not found — external attendees unverified';
        }
        record.transcriptCopyId = copyToSharedDrive(f);
        const rec = recordingByKey[key];
        if (rec) {
          record.recordingFileId = rec.getId();
          if (rec.getOwner()) record.recordingOwner = rec.getOwner().getEmail();
          try { rec.setSharing(DriveApp.Access.DOMAIN, DriveApp.Permission.VIEW); }
          catch (e) { /* view-only access — leave unshared */ }
        } else {
          record.notes = (record.notes ? record.notes + ' | ' : '') + 'Recording not found';
        }
      } catch (err) {
        record.status = 'error';
        record.notes = err.message;
      }
      logRecord(sheet, record);
      done.add(key);
      logged++;
    }
    if (timedOut) break;
  }

  Logger.log('Backfill: %s logged, %s already-present, %s before %s%s',
             logged, skipped, tooOld, BACKFILL_SINCE,
             timedOut ? ' — TIME LIMIT hit, run again to continue' : ' — DONE');
}

// ---------------------------------------------------------------------------
// SETUP NOTES — Calendar access
// ---------------------------------------------------------------------------
//
// For meetingbot to read attendee lists, it needs visibility of each rep's
// calendar. There are three ways to achieve this:
//
// OPTION A — Share calendar with meetingbot (recommended)
//   Each rep shares their Google Calendar with meetingbot (view-only access).
//   meetingbot can then search across all shared calendars automatically.
//   Reps do this via:
//     Google Calendar → Settings (gear) → Settings for my calendars
//     → [their calendar] → Share with specific people
//     → Add meetingbot@trovatrip.com with "See all event details" permission
//
// OPTION B — Invite meetingbot to meetings
//   Reps add meetingbot@trovatrip.com as a guest on each meeting.
//   Simpler per-meeting but requires remembering to do it every time.
//
// OPTION C — Domain-wide delegation (requires Workspace admin)
//   Grant meetingbot service account access to read any user's calendar.
//   Most powerful but requires Google Cloud Console setup.
//
// RECOMMENDED: Option A. One-time setup per rep, no ongoing effort needed.
