const express = require('express');
const db = require('../db');

const router = express.Router();

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// GET /api/rooms - list all rooms
router.get('/', (req, res) => {
  const rooms = db.prepare('SELECT id, name, color, created_at FROM rooms ORDER BY id ASC').all();
  res.json(rooms);
});

// POST /api/rooms - create a room
router.post('/', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '会议室名称不能为空', code: 'ROOM_NAME_REQUIRED' });

  let color = (req.body.color || '').trim();
  if (color && !HEX_COLOR_RE.test(color)) {
    return res.status(400).json({ error: '颜色格式不正确，应为 #RRGGBB', code: 'ROOM_COLOR_INVALID' });
  }
  if (!color) {
    const roomCount = db.prepare('SELECT COUNT(*) AS c FROM rooms').get().c;
    color = db.ROOM_PALETTE[roomCount % db.ROOM_PALETTE.length];
  }

  try {
    const info = db.prepare('INSERT INTO rooms (name, color) VALUES (?, ?)').run(name, color);
    const room = db.prepare('SELECT id, name, color, created_at FROM rooms WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(room);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: '已存在同名会议室', code: 'ROOM_DUPLICATE' });
    }
    res.status(500).json({ error: '创建会议室失败' });
  }
});

// PUT /api/rooms/:id - rename and/or recolor a room. Either field is
// optional so the color picker can update just the color without touching
// the name, and vice versa.
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id, name, color FROM rooms WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '会议室不存在', code: 'ROOM_NOT_FOUND' });

  const nameProvided = req.body.name !== undefined;
  const colorProvided = req.body.color !== undefined;

  const name = nameProvided ? String(req.body.name).trim() : existing.name;
  const color = colorProvided ? String(req.body.color).trim() : existing.color;

  if (nameProvided && !name) return res.status(400).json({ error: '会议室名称不能为空', code: 'ROOM_NAME_REQUIRED' });
  if (colorProvided && !HEX_COLOR_RE.test(color)) {
    return res.status(400).json({ error: '颜色格式不正确，应为 #RRGGBB', code: 'ROOM_COLOR_INVALID' });
  }

  try {
    db.prepare('UPDATE rooms SET name = ?, color = ? WHERE id = ?').run(name, color, id);
    const room = db.prepare('SELECT id, name, color, created_at FROM rooms WHERE id = ?').get(id);
    res.json(room);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: '已存在同名会议室', code: 'ROOM_DUPLICATE' });
    }
    res.status(500).json({ error: '更新会议室失败' });
  }
});

// DELETE /api/rooms/:id - delete a room (cascades to its meetings)
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM rooms WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '会议室不存在', code: 'ROOM_NOT_FOUND' });
  db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
  db.prepare("DELETE FROM settings WHERE key = ?").run(`announcement_room_${id}`);
  res.json({ ok: true });
});

module.exports = router;
