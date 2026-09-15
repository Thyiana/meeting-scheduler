const express = require('express');
const db = require('../db');
const { syncOneSource } = require('../icalSync');

const router = express.Router();

// GET /api/ical-sources
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, url, room_id, enabled, last_synced_at, last_sync_status
    FROM ical_sources ORDER BY id ASC
  `).all();
  res.json(rows);
});

// POST /api/ical-sources
router.post('/', (req, res) => {
  const name = (req.body.name || '').trim();
  const url = (req.body.url || '').trim();
  const room_id = req.body.room_id ? Number(req.body.room_id) : null;
  if (!name || !url) return res.status(400).json({ error: '请填写名称和 iCal URL' });

  const info = db.prepare(
    'INSERT INTO ical_sources (name, url, room_id, enabled) VALUES (?, ?, ?, 1)'
  ).run(name, url, room_id);
  const source = db.prepare('SELECT * FROM ical_sources WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(source);
});

// DELETE /api/ical-sources/:id
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM ical_sources WHERE id = ?').run(id);
  res.json({ ok: true });
});

// POST /api/ical-sources/:id/sync-now - manually trigger a single source sync.
// This responds immediately with "started" and never blocks the request
// thread on the outbound network call; the result lands in last_sync_status.
router.post('/:id/sync-now', (req, res) => {
  const id = Number(req.params.id);
  const source = db.prepare('SELECT * FROM ical_sources WHERE id = ?').get(id);
  if (!source) return res.status(404).json({ error: '同步源不存在' });

  res.json({ ok: true, message: '同步已在后台开始' });
  // Fire-and-forget; errors are caught and logged inside syncOneSource so
  // they can never surface as an unhandled rejection or block the loop.
  setImmediate(() => syncOneSource(source));
});

module.exports = router;
