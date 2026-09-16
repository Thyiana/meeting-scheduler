const ical = require('node-ical');
const db = require('./db');

const FETCH_TIMEOUT_MS = 8000;
const VALID_RANGE_START = new Date('2026-09-28T00:00:00');
const VALID_RANGE_END = new Date('2026-10-02T00:00:00');

function toLocalIso(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Fetch + parse a single iCal source and upsert its events into the
 * meetings table. Designed to NEVER throw and NEVER block the Node.js
 * event loop for long:
 *  - the network fetch is bounded by an AbortController timeout so a slow
 *    or dead third-party server degrades gracefully instead of hanging;
 *  - ICS parsing runs in the same tick but is wrapped in try/catch, and the
 *    per-source workload is small (a single calendar feed), so it never
 *    competes meaningfully with the HTTP request handlers;
 *  - any error (network, parse, timeout) is caught, recorded on the source
 *    row, and swallowed so one bad feed can never take down /api/meetings.
 */
async function syncOneSource(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let status = 'ok';
  let importedCount = 0;

  try {
    const response = await fetch(source.url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    const parsed = ical.parseICS(text);

    const fallbackRoomId = source.room_id
      || db.prepare('SELECT id FROM rooms ORDER BY id ASC LIMIT 1').get()?.id;

    const upsert = db.prepare(`
      INSERT INTO meetings (room_id, topic, host, start_time, end_time, attendee_link, source, external_uid)
      VALUES ($room_id, $topic, $host, $start_time, $end_time, $attendee_link, 'ical', $external_uid)
      ON CONFLICT(external_uid) DO UPDATE SET
        topic = excluded.topic,
        host = excluded.host,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        updated_at = datetime('now')
    `);

    const runBatch = (events) => db.withTransaction(() => {
      for (const ev of events) {
        if (!ev.start || !ev.end) continue;
        const start = new Date(ev.start);
        const end = new Date(ev.end);
        if (start < VALID_RANGE_START || end > VALID_RANGE_END) continue; // outside managed window
        if (!fallbackRoomId) continue; // no room to attach to

        upsert.run({
          room_id: fallbackRoomId,
          topic: ev.summary || '(未命名事件)',
          host: ev.organizer ? String(ev.organizer.params?.CN || ev.organizer.val || '外部日历') : '外部日历',
          start_time: toLocalIso(start),
          end_time: toLocalIso(end),
          attendee_link: '',
          external_uid: `${source.id}:${ev.uid || `${ev.summary}-${start.toISOString()}`}`,
        });
        importedCount += 1;
      }
    });

    const events = Object.values(parsed).filter((e) => e.type === 'VEVENT');
    runBatch(events);
  } catch (err) {
    status = err.name === 'AbortError' ? 'timeout' : `error: ${err.message}`;
  } finally {
    clearTimeout(timer);
    try {
      db.prepare(`
        UPDATE ical_sources
        SET last_synced_at = datetime('now'), last_sync_status = ?
        WHERE id = ?
      `).run(`${status} (${importedCount} 条)`, source.id);
    } catch (e) {
      // never let bookkeeping errors propagate
    }
  }
}

/**
 * Sync all enabled sources sequentially, one at a time, so a burst of
 * sources never spikes CPU/network concurrently. Each call is awaited but
 * the whole batch itself is invoked from cron via setImmediate so it never
 * runs inline with an incoming HTTP request.
 */
async function syncAllSources() {
  const sources = db.prepare('SELECT * FROM ical_sources WHERE enabled = 1').all();
  for (const source of sources) {
    await syncOneSource(source);
  }
}

module.exports = { syncOneSource, syncAllSources };
