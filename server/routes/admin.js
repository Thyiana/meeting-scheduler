const express = require('express');
const db = require('../db');
const backup = require('../backup');

const router = express.Router();

const GLOBAL_KEY = 'announcement_banner';
const roomKey = (roomId) => `announcement_room_${roomId}`;

// GET /api/admin/announcements
router.get('/announcements', (req, res) => {
  try {
    const rows = db.prepare(`SELECT key, value, updated_at FROM settings WHERE key = ? OR key LIKE 'announcement_room_%'`).all(GLOBAL_KEY);
    const globalRow = rows.find((r) => r.key === GLOBAL_KEY);
    const rooms = {};
    rows.filter((r) => r.key !== GLOBAL_KEY).forEach((r) => {
      const roomId = r.key.replace('announcement_room_', '');
      rooms[roomId] = r.value || '';
    });
    res.json({ global: (globalRow && globalRow.value) || '', rooms });
  } catch (err) {
    console.error('[admin/announcements/get] error:', err);
    res.status(500).json({ error: '获取公告失败: ' + err.message });
  }
});

// PUT /api/admin/announcements/global
router.put('/announcements/global', (req, res) => {
  try {
    const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(GLOBAL_KEY, message);
    res.json({ message });
  } catch (err) {
    console.error('[admin/announcements/global] error:', err);
    res.status(500).json({ error: '保存全局公告失败: ' + err.message });
  }
});

// PUT /api/admin/announcements/room/:roomId
router.put('/announcements/room/:roomId', (req, res) => {
  try {
    const roomId = Number(req.params.roomId);
    const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
    if (!room) return res.status(404).json({ error: '会议室不存在', code: 'ROOM_NOT_FOUND' });

    // 优化大文本 Base64 字符串处理，防止处理超长 JSON 时报错
    const message = typeof req.body.message === 'string' ? req.body.message : JSON.stringify(req.body.message || '');

    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(roomKey(roomId), message);

    res.json({ roomId, message });
  } catch (err) {
    console.error('[admin/announcements/room] 详细报错信息:', err);
    res.status(500).json({ error: '保存会议室公告失败: ' + err.message });
  }
});

// POST /api/admin/reset
router.post('/reset', (req, res) => {
  if (req.body.confirm !== 'RESET') {
    return res.status(400).json({ error: '需要确认才能执行重置', code: 'RESET_NOT_CONFIRMED' });
  }
  let backupFile = null;
  try {
    backupFile = backup.writeBackupFile('reset').filename;
  } catch (err) {
    console.error('[admin/reset] backup failed:', err.message);
  }
  const info = db.prepare('DELETE FROM meetings').run();
  res.json({ ok: true, deleted: info.changes, backupFile });
});

// GET /api/admin/backups
router.get('/backups', (req, res) => {
  res.json(backup.listBackups());
});

// GET /api/admin/backups/:filename
router.get('/backups/:filename', (req, res) => {
  const full = backup.resolveBackupPath(req.params.filename);
  if (!full) return res.status(404).json({ error: '备份文件不存在', code: 'BACKUP_NOT_FOUND' });
  res.download(full);
});

// POST /api/admin/backups
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