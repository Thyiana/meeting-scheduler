const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// The data directory can be overridden with the DATA_DIR environment
// variable — this matters on hosts like Render, whose default filesystem is
// wiped on every new deploy. Pointing DATA_DIR at a mounted persistent disk
// (e.g. DATA_DIR=/var/data) keeps the database across deploys and restarts;
// without it, this just defaults to a local ./data folder as before.
const DATA_DIR = process.env.DATA_DIR
  ? process.env.DATA_DIR
  : path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'scheduler.db');

const db = new DatabaseSync(DB_PATH);

// --- Concurrency & durability settings ---
// WAL mode allows concurrent readers while a write is in progress and is far
// more resilient to abrupt process termination than the default rollback
// journal (no stale journal file left behind causing a "database is locked"
// state on next boot).
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA foreign_keys = ON');
// Give concurrent writers a grace period instead of failing immediately with
// SQLITE_BUSY when the WAL is momentarily checkpointing.
db.exec('PRAGMA busy_timeout = 5000');

// node:sqlite's DatabaseSync has no built-in `.transaction()` helper (unlike
// better-sqlite3), so this small wrapper gives call sites the same
// BEGIN/COMMIT/ROLLBACK safety with a plain function.
function withTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (e) { /* ignore */ }
    throw err;
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#1c1b18',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  host TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  attendee_link TEXT,
  card_color TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  external_uid TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meetings_room ON meetings(room_id);
CREATE INDEX IF NOT EXISTS idx_meetings_time ON meetings(start_time, end_time);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_external_uid ON meetings(external_uid) WHERE external_uid IS NOT NULL;

-- Small generic key/value store. Currently used for the single global
-- "emergency banner" announcement shown on the guest page, but kept generic
-- so future site-wide settings can reuse it without another migration.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Shared palette used to auto-assign a new room's default color; the user
// can still override any room's color individually from the sidebar.
const ROOM_PALETTE = ['#1c1b18', '#8a5a44', '#3f6659', '#5b6b8c', '#8a6d3b', '#6b5b7a', '#4b473e', '#a3492f'];

// --- Lightweight migration: older databases created before the "color"
// column existed won't have it. Add it on boot if missing so upgrading
// never forces the user to delete their existing data. ---
const roomColumns = db.prepare('PRAGMA table_info(rooms)').all().map((c) => c.name);
if (!roomColumns.includes('color')) {
  db.exec("ALTER TABLE rooms ADD COLUMN color TEXT NOT NULL DEFAULT '#1c1b18'");
  // Spread any pre-existing rooms across the palette once, right after the
  // migration, instead of leaving them all on the same fallback color.
  const existingRooms = db.prepare('SELECT id FROM rooms ORDER BY id ASC').all();
  if (existingRooms.length) {
    const update = db.prepare('UPDATE rooms SET color = ? WHERE id = ?');
    withTransaction(() => {
      existingRooms.forEach((r, i) => update.run(ROOM_PALETTE[i % ROOM_PALETTE.length], r.id));
    });
  }
}

// --- Same migration pattern for meetings.card_color (per-meeting color
// override), added after the initial release. ---
const meetingColumns = db.prepare('PRAGMA table_info(meetings)').all().map((c) => c.name);
if (!meetingColumns.includes('card_color')) {
  db.exec('ALTER TABLE meetings ADD COLUMN card_color TEXT');
}
// "contact" holds a free-text phone number / note, shown in the Excel
// export's "联系电话/备注" column and in the meeting detail views.
if (!meetingColumns.includes('contact')) {
  db.exec('ALTER TABLE meetings ADD COLUMN contact TEXT');
}

// Seed a couple of default rooms on first run so the UI is never empty.
const roomCount = db.prepare('SELECT COUNT(*) AS c FROM rooms').get().c;
if (roomCount === 0) {
  const insert = db.prepare('INSERT INTO rooms (name, color) VALUES (?, ?)');
  withTransaction(() => {
    insert.run('会议室 A', ROOM_PALETTE[0]);
    insert.run('会议室 B', ROOM_PALETTE[1]);
  });
}

// --- Graceful shutdown: always checkpoint + close cleanly so an abrupt kill
// never leaves the WAL file in a state that locks the main db file. ---
function shutdown() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
  } catch (err) {
    // ignore - process is exiting anyway
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { /* noop */ }
});

module.exports = db;
module.exports.withTransaction = withTransaction;
module.exports.ROOM_PALETTE = ROOM_PALETTE;
module.exports.DATA_DIR = DATA_DIR;

