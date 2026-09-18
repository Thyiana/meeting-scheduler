const express = require('express');
const db = require('../db');

const router = express.Router();

// The scheduler only manages this fixed window (inclusive of both dates).
const VALID_RANGE_START = '2026-09-28T00:00:00';
const VALID_RANGE_END = '2026-10-01T00:00:00'; // exclusive upper bound (end of 09-30)

function inValidRange(iso) {
  return iso >= VALID_RANGE_START && iso <= VALID_RANGE_END;
}

function normalizeDateTime(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (!str) return null;
  // Accept "YYYY-MM-DD HH:mm" or "YYYY-MM-DDTHH:mm[:ss]"
  const normalized = str.replace(' ', 'T');
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/);
  if (!match) return null;
  return match[2] ? normalized : `${normalized}:00`;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// Every validation failure carries a `code` (used by the frontend's i18n
// dictionary to show the message in whichever language is active) plus a
// Chinese `error` string as a sane fallback for any caller that ignores it.
function validateMeetingPayload(body) {
  const room_id = Number(body.room_id);
  const topic = (body.topic || '').trim();
  const host = (body.host || '').trim();
  const start_time = normalizeDateTime(body.start_time);
  const end_time = normalizeDateTime(body.end_time);
  const attendee_link = (body.attendee_link || '').trim();
  const contact = (body.contact || '').trim().slice(0, 200);

  if (!room_id) return { error: '请选择会议室', code: 'MEETING_ROOM_REQUIRED' };
  if (!topic) return { error: '请输入会议主题', code: 'MEETING_TOPIC_REQUIRED' };
  if (!host) return { error: '请输入主持人/负责人', code: 'MEETING_HOST_REQUIRED' };
  if (!start_time || !end_time) return { error: '开始/结束时间格式不正确', code: 'MEETING_TIME_INVALID' };
  if (start_time >= end_time) return { error: '结束时间必须晚于开始时间', code: 'MEETING_END_BEFORE_START' };
  if (!inValidRange(start_time) || !inValidRange(end_time)) {
    return { error: '会议时间需在 2026-09-28 至 2026-09-30 排期区间内', code: 'MEETING_OUT_OF_RANGE' };
  }
  const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(room_id);
  if (!room) return { error: '所选会议室不存在', code: 'MEETING_ROOM_NOT_FOUND' };

  // card_color is optional: null/empty means "use the room's default color".
  let card_color = body.card_color === undefined || body.card_color === null
    ? null
    : String(body.card_color).trim();
  if (card_color === '') card_color = null;
  if (card_color !== null && !HEX_COLOR_RE.test(card_color)) {
    return { error: '卡片颜色格式不正确，应为 #RRGGBB', code: 'MEETING_COLOR_INVALID' };
  }

  return { value: { room_id, topic, host, start_time, end_time, attendee_link, card_color, contact } };
}

// Buffer-time check is advisory only (never blocks a save): it looks at the
// nearest other booking in the same room and, if it starts/ends within the
// requested 15-minute buffer, returns a warning string the frontend shows
// as a toast so the organizer can decide whether to adjust it themselves.
const BUFFER_MINUTES = 15;
function bufferWarning(room_id, start_time, end_time, excludeId) {
  const neighbors = db.prepare(
    `SELECT topic, start_time, end_time FROM meetings
     WHERE room_id = ? AND id != COALESCE(?, -1)
     ORDER BY start_time ASC`
  ).all(room_id, excludeId || null);
  const start = new Date(start_time);
  const end = new Date(end_time);
  for (const m of neighbors) {
    const otherStart = new Date(m.start_time);
    const otherEnd = new Date(m.end_time);
    const gapBefore = (start - otherEnd) / 60000; // this meeting starts after other ends
    const gapAfter = (otherStart - end) / 60000; // this meeting ends before other starts
    if (gapBefore >= 0 && gapBefore < BUFFER_MINUTES) {
      return { code: 'BUFFER_TOO_SHORT_BEFORE', minutes: Math.round(gapBefore), topic: m.topic };
    }
    if (gapAfter >= 0 && gapAfter < BUFFER_MINUTES) {
      return { code: 'BUFFER_TOO_SHORT_AFTER', minutes: Math.round(gapAfter), topic: m.topic };
    }
  }
  return null;
}

function hasConflict(room_id, start_time, end_time, excludeId) {
  const row = db.prepare(
    `SELECT id FROM meetings
     WHERE room_id = ?
       AND id != COALESCE(?, -1)
       AND start_time < ? AND end_time > ?
     LIMIT 1`
  ).get(room_id, excludeId || null, end_time, start_time);
  return !!row;
}

function toLocalIso(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// When a booking is rejected for conflicting with an existing one, this
// looks for two things a frustrated organizer would immediately want to
// know instead of just "no": (1) the next free slot of the same length in
// the *same* room, and (2) which *other* rooms are free at the exact time
// they originally asked for. Both are best-effort — a null/empty result
// just means "nothing else to suggest", never an error.
function findAlternatives(room_id, start_time, end_time, excludeId) {
  const durationMs = new Date(end_time) - new Date(start_time);

  // (1) Walk forward through this room's existing bookings (on or after the
  // requested start) looking for the first gap big enough to fit the same
  // duration. Bounded to the managed window and a sane number of hops so a
  // pathologically double-booked room can never loop for long.
  const roomMeetings = db.prepare(
    `SELECT start_time, end_time FROM meetings
     WHERE room_id = ? AND id != COALESCE(?, -1) AND end_time > ?
     ORDER BY start_time ASC LIMIT 200`
  ).all(room_id, excludeId || null, start_time);

  let cursor = new Date(start_time);
  let nextFreeSlot = null;
  for (const m of roomMeetings) {
    const mStart = new Date(m.start_time);
    const mEnd = new Date(m.end_time);
    if (mStart - cursor >= durationMs) { nextFreeSlot = { start: cursor, end: new Date(cursor.getTime() + durationMs) }; break; }
    if (mEnd > cursor) cursor = mEnd;
  }
  if (!nextFreeSlot) {
    const candidateEnd = new Date(cursor.getTime() + durationMs);
    if (toLocalIso(candidateEnd) <= VALID_RANGE_END) {
      nextFreeSlot = { start: cursor, end: candidateEnd };
    }
  }

  // (2) Any other room that's free for the exact time originally requested.
  const freeRoomNames = db.prepare('SELECT id, name FROM rooms WHERE id != ? ORDER BY id ASC').all(room_id)
    .filter((r) => !hasConflict(r.id, start_time, end_time))
    .map((r) => r.name);

  return {
    nextFreeSlot: nextFreeSlot ? { start_time: toLocalIso(nextFreeSlot.start), end_time: toLocalIso(nextFreeSlot.end) } : null,
    freeRooms: freeRoomNames.slice(0, 5), // a long list stops being useful as a quick suggestion
  };
}

const MEETING_COLUMNS = `m.id, m.room_id, r.name AS room_name, m.topic, m.host,
           m.start_time, m.end_time, m.attendee_link, m.contact, m.card_color, m.source, m.updated_at`;

// GET /api/meetings - list meetings, joined with room name. Guest and admin
// pages both poll this on a short interval for near-real-time updates, so
// it stays a single cheap indexed query with no server-side pagination.
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT ${MEETING_COLUMNS}
    FROM meetings m
    JOIN rooms r ON r.id = m.room_id
    ORDER BY m.start_time ASC
  `).all();
  res.json(rows);
});

// POST /api/meetings - create a meeting
router.post('/', (req, res) => {
  const { error, code, value } = validateMeetingPayload(req.body);
  if (error) return res.status(400).json({ error, code });
  if (hasConflict(value.room_id, value.start_time, value.end_time)) {
    return res.status(409).json({
      error: '该会议室在此时间段已有预约，存在时间冲突',
      code: 'MEETING_CONFLICT',
      ...findAlternatives(value.room_id, value.start_time, value.end_time),
    });
  }
  const info = db.prepare(`
    INSERT INTO meetings (room_id, topic, host, start_time, end_time, attendee_link, contact, card_color, source)
    VALUES ($room_id, $topic, $host, $start_time, $end_time, $attendee_link, $contact, $card_color, 'manual')
  `).run(value);
  const meeting = db.prepare(`
    SELECT ${MEETING_COLUMNS} FROM meetings m JOIN rooms r ON r.id = m.room_id WHERE m.id = ?
  `).get(info.lastInsertRowid);
  const warning = bufferWarning(value.room_id, value.start_time, value.end_time, meeting.id);
  res.status(201).json({ ...meeting, warning });
});

// PUT /api/meetings/:id - update a meeting
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id, updated_at FROM meetings WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '预约不存在', code: 'MEETING_NOT_FOUND' });

  // Optimistic concurrency: the client must echo back the updated_at it last
  // saw. If someone else's edit landed in between (e.g. two people editing
  // the same slot at once on a shaky connection), this catches it instead of
  // silently overwriting their change.
  if (req.body.expected_updated_at && req.body.expected_updated_at !== existing.updated_at) {
    return res.status(409).json({ error: '该预约已被他人修改，请刷新后重试', code: 'MEETING_STALE' });
  }

  const { error, code, value } = validateMeetingPayload(req.body);
  if (error) return res.status(400).json({ error, code });
  if (hasConflict(value.room_id, value.start_time, value.end_time, id)) {
    return res.status(409).json({
      error: '该会议室在此时间段已有预约，存在时间冲突',
      code: 'MEETING_CONFLICT',
      ...findAlternatives(value.room_id, value.start_time, value.end_time, id),
    });
  }
  db.prepare(`
    UPDATE meetings
    SET room_id = $room_id, topic = $topic, host = $host,
        start_time = $start_time, end_time = $end_time,
        attendee_link = $attendee_link, contact = $contact, card_color = $card_color, updated_at = datetime('now')
    WHERE id = @id
  `).run({ ...value, id });

  const meeting = db.prepare(`
    SELECT ${MEETING_COLUMNS} FROM meetings m JOIN rooms r ON r.id = m.room_id WHERE m.id = ?
  `).get(id);
  const warning = bufferWarning(value.room_id, value.start_time, value.end_time, id);
  res.json({ ...meeting, warning });
});

// POST /api/meetings/bulk - import many meetings at once (used by the
// admin "导入 Excel" feature). Each row is validated and conflict-checked
// independently and inserted immediately if it passes — a bad row never
// blocks the good ones, since realistically an imported spreadsheet is a
// mix of clean data and a few mistakes that need calling out individually.
// Accepts room_id OR room_name per row (name is resolved case-insensitively
// against existing rooms) since a spreadsheet naturally has room names, not
// internal IDs.
router.post('/bulk', (req, res) => {
  const rows = Array.isArray(req.body.meetings) ? req.body.meetings.slice(0, 1000) : null;
  if (!rows) return res.status(400).json({ error: '请提供 meetings 数组', code: 'BULK_PAYLOAD_INVALID' });

  const rooms = db.prepare('SELECT id, name FROM rooms').all();
  const roomByName = new Map(rooms.map((r) => [r.name.trim().toLowerCase(), r.id]));

  const results = rows.map((row, index) => {
    const body = { ...row };
    if (!body.room_id && body.room_name) {
      const matchId = roomByName.get(String(body.room_name).trim().toLowerCase());
      if (!matchId) return { index, ok: false, error: `找不到会议室"${body.room_name}"`, code: 'MEETING_ROOM_NOT_FOUND' };
      body.room_id = matchId;
    }
    const { error, code, value } = validateMeetingPayload(body);
    if (error) return { index, ok: false, error, code };
    if (hasConflict(value.room_id, value.start_time, value.end_time)) {
      return {
        index, ok: false, error: '该会议室在此时间段已有预约，存在时间冲突', code: 'MEETING_CONFLICT',
        ...findAlternatives(value.room_id, value.start_time, value.end_time),
      };
    }
    const info = db.prepare(`
      INSERT INTO meetings (room_id, topic, host, start_time, end_time, attendee_link, contact, card_color, source)
      VALUES ($room_id, $topic, $host, $start_time, $end_time, $attendee_link, $contact, $card_color, 'import')
    `).run(value);
    return { index, ok: true, id: info.lastInsertRowid };
  });

  const imported = results.filter((r) => r.ok).length;
  res.json({ imported, failed: results.length - imported, results });
});


router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM meetings WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '预约不存在', code: 'MEETING_NOT_FOUND' });
  db.prepare('DELETE FROM meetings WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
