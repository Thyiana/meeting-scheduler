const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../db');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// The scheduler only manages this fixed window (inclusive of both dates).
const VALID_RANGE_START = '2026-09-28T00:00:00';
const VALID_RANGE_END = '2026-10-02T00:00:00'; // exclusive upper bound (end of 10-01)

function inValidRange(iso) {
  return iso >= VALID_RANGE_START && iso <= VALID_RANGE_END;
}

function normalizeDateTime(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    // Excel serial date number
    const parsed = XLSX.SSF ? XLSX.SSF.parse_date_code(value) : null;
    if (!parsed) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}T${pad(parsed.H)}:${pad(parsed.M)}:${pad(Math.floor(parsed.S || 0))}`;
  }
  const str = String(value).trim();
  if (!str) return null;
  // Accept "YYYY-MM-DD HH:mm" or "YYYY-MM-DDTHH:mm[:ss]"
  const normalized = str.replace(' ', 'T');
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/);
  if (!match) return null;
  return match[2] ? normalized : `${normalized}:00`;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function validateMeetingPayload(body) {
  const room_id = Number(body.room_id);
  const topic = (body.topic || '').trim();
  const host = (body.host || '').trim();
  const start_time = normalizeDateTime(body.start_time);
  const end_time = normalizeDateTime(body.end_time);
  const attendee_link = (body.attendee_link || '').trim();

  if (!room_id) return { error: '请选择会议室' };
  if (!topic) return { error: '请输入会议主题' };
  if (!host) return { error: '请输入主持人/负责人' };
  if (!start_time || !end_time) return { error: '开始/结束时间格式不正确' };
  if (start_time >= end_time) return { error: '结束时间必须晚于开始时间' };
  if (!inValidRange(start_time) || !inValidRange(end_time)) {
    return { error: '会议时间需在 2026-09-28 至 2026-10-01 排期区间内' };
  }
  const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(room_id);
  if (!room) return { error: '所选会议室不存在' };

  // card_color is optional: null/empty means "use the room's default color".
  let card_color = body.card_color === undefined || body.card_color === null
    ? null
    : String(body.card_color).trim();
  if (card_color === '') card_color = null;
  if (card_color !== null && !HEX_COLOR_RE.test(card_color)) {
    return { error: '卡片颜色格式不正确，应为 #RRGGBB' };
  }

  return { value: { room_id, topic, host, start_time, end_time, attendee_link, card_color } };
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

// GET /api/meetings - list meetings (optionally filtered by range), joined with room name
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT m.id, m.room_id, r.name AS room_name, m.topic, m.host,
           m.start_time, m.end_time, m.attendee_link, m.card_color, m.source
    FROM meetings m
    JOIN rooms r ON r.id = m.room_id
    ORDER BY m.start_time ASC
  `).all();
  res.json(rows);
});

// POST /api/meetings - create a meeting
router.post('/', (req, res) => {
  const { error, value } = validateMeetingPayload(req.body);
  if (error) return res.status(400).json({ error });
  if (hasConflict(value.room_id, value.start_time, value.end_time)) {
    return res.status(409).json({ error: '该会议室在此时间段已有预约，存在时间冲突' });
  }
  const info = db.prepare(`
    INSERT INTO meetings (room_id, topic, host, start_time, end_time, attendee_link, card_color, source)
    VALUES ($room_id, $topic, $host, $start_time, $end_time, $attendee_link, $card_color, 'manual')
  `).run(value);
  const meeting = db.prepare(`
    SELECT m.id, m.room_id, r.name AS room_name, m.topic, m.host, m.start_time, m.end_time, m.attendee_link, m.card_color, m.source
    FROM meetings m JOIN rooms r ON r.id = m.room_id WHERE m.id = ?
  `).get(info.lastInsertRowid);
  res.status(201).json(meeting);
});

// PUT /api/meetings/:id - update a meeting
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM meetings WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '预约不存在' });

  const { error, value } = validateMeetingPayload(req.body);
  if (error) return res.status(400).json({ error });
  if (hasConflict(value.room_id, value.start_time, value.end_time, id)) {
    return res.status(409).json({ error: '该会议室在此时间段已有预约，存在时间冲突' });
  }
  db.prepare(`
    UPDATE meetings
    SET room_id = $room_id, topic = $topic, host = $host,
        start_time = $start_time, end_time = $end_time,
        attendee_link = $attendee_link, card_color = $card_color, updated_at = datetime('now')
    WHERE id = @id
  `).run({ ...value, id });

  const meeting = db.prepare(`
    SELECT m.id, m.room_id, r.name AS room_name, m.topic, m.host, m.start_time, m.end_time, m.attendee_link, m.card_color, m.source
    FROM meetings m JOIN rooms r ON r.id = m.room_id WHERE m.id = ?
  `).get(id);
  res.json(meeting);
});

// DELETE /api/meetings/:id
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM meetings WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '预约不存在' });
  db.prepare('DELETE FROM meetings WHERE id = ?').run(id);
  res.json({ ok: true });
});

// POST /api/meetings/import - bulk import from an uploaded .xlsx / .csv file
// Expected columns (header row, Chinese or English both accepted):
// 会议室/room, 主题/topic, 主持人/host, 开始时间/start_time, 结束时间/end_time, 名单链接/attendee_link
router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传文件' });

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
  } catch (err) {
    return res.status(400).json({ error: '文件解析失败，请确认为 .xlsx 或 .csv 格式' });
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const pick = (row, keys) => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== '') return row[k];
    }
    return '';
  };

  const roomCache = new Map(
    db.prepare('SELECT id, name FROM rooms').all().map((r) => [r.name, r.id])
  );
  const getOrCreateRoom = (name) => {
    if (roomCache.has(name)) return roomCache.get(name);
    const info = db.prepare('INSERT INTO rooms (name) VALUES (?)').run(name);
    roomCache.set(name, info.lastInsertRowid);
    return info.lastInsertRowid;
  };

  const insertStmt = db.prepare(`
    INSERT INTO meetings (room_id, topic, host, start_time, end_time, attendee_link, source)
    VALUES ($room_id, $topic, $host, $start_time, $end_time, $attendee_link, 'import')
  `);

  const results = { imported: 0, skipped: [] };

  const runImport = (items) => db.withTransaction(() => {
    items.forEach((row, idx) => {
      const roomName = String(pick(row, ['会议室', 'room', 'Room', '会议室名称'])).trim();
      const topic = String(pick(row, ['主题', 'topic', 'Topic', '会议主题'])).trim();
      const host = String(pick(row, ['主持人', 'host', 'Host', '负责人', '主持人/负责人'])).trim();
      const start_time = normalizeDateTime(pick(row, ['开始时间', 'start_time', 'Start', '起始时间']));
      const end_time = normalizeDateTime(pick(row, ['结束时间', 'end_time', 'End']));
      const attendee_link = String(pick(row, ['名单链接', 'attendee_link', 'Link', '参会人员名单链接'])).trim();

      if (!roomName || !topic || !host || !start_time || !end_time) {
        results.skipped.push({ row: idx + 2, reason: '缺少必填字段' });
        return;
      }
      if (start_time >= end_time) {
        results.skipped.push({ row: idx + 2, reason: '结束时间早于开始时间' });
        return;
      }
      if (!inValidRange(start_time) || !inValidRange(end_time)) {
        results.skipped.push({ row: idx + 2, reason: '不在 2026-09-28 至 2026-10-01 排期区间内' });
        return;
      }
      const room_id = getOrCreateRoom(roomName);
      if (hasConflict(room_id, start_time, end_time)) {
        results.skipped.push({ row: idx + 2, reason: `与「${roomName}」已有预约冲突` });
        return;
      }
      insertStmt.run({ room_id, topic, host, start_time, end_time, attendee_link });
      results.imported += 1;
    });
  });

  try {
    runImport(rows);
  } catch (err) {
    return res.status(500).json({ error: '导入过程中发生错误：' + err.message });
  }

  res.json(results);
});

module.exports = router;
