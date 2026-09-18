const express = require('express');
const db = require('../db');

const router = express.Router();

const BANNER_KEY = 'announcement_banner';

// GET /api/admin/announcement - current emergency banner (guest page polls
// this so a delay announced from the console shows up on attendees' phones
// within a few seconds, no reload needed).
router.get('/announcement', (req, res) => {
  const row = db.prepare('SELECT value, updated_at FROM settings WHERE key = ?').get(BANNER_KEY);
  res.json({ message: (row && row.value) || '', updated_at: row ? row.updated_at : null });
});

// PUT /api/admin/announcement - publish (or clear, with an empty string) the
// banner. No auth layer exists in this app (same trust model as every other
// admin-only route here), so this is only as protected as the admin URL.
router.put('/announcement', (req, res) => {
  const message = (req.body.message || '').toString().trim().slice(0, 300);
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(BANNER_KEY, message);
  res.json({ message });
});

// POST /api/admin/reset - wipes every booking (rooms are kept). Meant for
// "clear all test data right before doors open"; the frontend is expected
// to gate this behind its own double-confirmation UI, and this endpoint
// additionally requires an explicit confirm flag so it can never be
// triggered by an accidental bare POST.
router.post('/reset', (req, res) => {
  if (req.body.confirm !== 'RESET') {
    return res.status(400).json({ error: '需要确认才能执行重置', code: 'RESET_NOT_CONFIRMED' });
  }
  const info = db.prepare('DELETE FROM meetings').run();
  res.json({ ok: true, deleted: info.changes });
});

module.exports = router;
