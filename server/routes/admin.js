const express = require('express');
const db = require('../db');
const backup = require('../backup');

const router = express.Router();

const GLOBAL_KEY = 'announcement_banner';
const roomKey = (roomId) => `announcement_room_${roomId}`;

// GET /api/admin/announcements - the global banner plus every room's own
// banner in one call, so the guest page (which may be locked to a single
// room via its invite link) and the door signage board (which needs every
// room's banner at once) can both poll a single lightweight endpoint.
router.get('/announcements', (req, res) => {
  const rows = db.prepare(`SELECT key, value, updated_at FROM settings WHERE key = ? OR key LIKE 'announcement_room_%'`).all(GLOBAL_KEY);
  const globalRow = rows.find((r) => r.key === GLOBAL_KEY);
  const rooms = {};
  rows.filter((r) => r.key !== GLOBAL_KEY).forEach((r) => {
    const roomId = r.key.replace('announcement_room_', '');
    rooms[roomId] = r.value || '';
  });
  res.json({ global: (globalRow && globalRow.value) || '', rooms });
});

// PUT /api/admin/announcements/global - publish (or clear with an empty
// string) the system-wide banner, shown on every room regardless of any
// per-room banner.
router.put('/announcements/global', (req, res) => {
  const message = (req.body.message || '').toString().trim().slice(0, 300);
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(GLOBAL_KEY, message);
  res.json({ message });
});

// PUT /api/admin/announcements/room/:roomId - publish (or clear) a banner
// scoped to just one room — e.g. "该会议室临时改到 3 楼" — shown alongside,
// not instead of, the global banner.
router.put('/announcements/room/:roomId', (req, res) => {
  const roomId = Number(req.params.roomId);
  const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
  if (!room) return res.status(404).json({ error: '会议室不存在', code: 'ROOM_NOT_FOUND' });
  const message = (req.body.message || '').toString().trim().slice(0, 300);
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(roomKey(roomId), message);
  res.json({ roomId, message });
});

// POST /api/admin/reset - wipes every booking (rooms are kept). Meant for
// "clear all test data right before doors open"; the frontend is expected
// to gate this behind its own double-confirmation UI, and this endpoint
// additionally requires an explicit confirm flag so it can never be
// triggered by an accidental bare POST.
//
// Before deleting anything, a full .xlsx snapshot of the current schedule
// is written to disk (see ../backup.js) — a careless RESET is still fully
// recoverable afterwards by downloading that file from /api/admin/backups.
router.post('/reset', (req, res) => {
  if (req.body.confirm !== 'RESET') {
    return res.status(400).json({ error: '需要确认才能执行重置', code: 'RESET_NOT_CONFIRMED' });
  }
  let backupFile = null;
  try {
    backupFile = backup.writeBackupFile('reset').filename;
  } catch (err) {
    // A backup failure should never itself block the reset the operator
    // explicitly confirmed twice — but it's surfaced in the response so the
    // frontend can warn "reset succeeded, backup did NOT" instead of
    // silently implying a safety net exists when it doesn't.
    console.error('[admin/reset] backup failed:', err.message);
  }
  const info = db.prepare('DELETE FROM meetings').run();
  res.json({ ok: true, deleted: info.changes, backupFile });
});

// GET /api/admin/backups - list available snapshots, newest first
router.get('/backups', (req, res) => {
  res.json(backup.listBackups());
});

// GET /api/admin/backups/:filename - download one snapshot
router.get('/backups/:filename', (req, res) => {
  const full = backup.resolveBackupPath(req.params.filename);
  if (!full) return res.status(404).json({ error: '备份文件不存在', code: 'BACKUP_NOT_FOUND' });
  res.download(full);
});

// POST /api/admin/backups - manually trigger a snapshot on demand (not just
// automatically before a reset), in case an operator wants an ad-hoc save
// point before making a batch of risky changes.
router.post('/backups', (req, res) => {
  try {
    const result = backup.writeBackupFile('manual');
    res.status(201).json(result);
  } catch (err) {
    console.error('[admin/backups] manual backup failed:', err.message);
    res.status(500).json({ error: '备份失败', code: 'BACKUP_FAILED' });
  }
});

module.exports = router;
