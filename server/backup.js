const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const db = require('./db');

// Backups live next to the database itself, inside the same DATA_DIR — so
// on a host with a persistent disk (Render Starter + DATA_DIR) they survive
// deploys exactly like the live data does, instead of vanishing on the next
// deploy if they were left in the app's own ephemeral filesystem.
const BACKUP_DIR = path.join(db.DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Keep at most this many backup files; older ones are pruned whenever a new
// one is written, so an unattended system doing daily test-resets can never
// slowly fill the disk.
const MAX_BACKUPS = 30;

function sanitizeSheetName(name, fallback) {
  const cleaned = String(name || fallback).replace(/[\\/?*[\]:]/g, '').slice(0, 31);
  return cleaned || fallback;
}

function splitDateTime(isoLike) {
  const d = new Date((isoLike || '').replace(' ', 'T'));
  const pad = (n) => String(n).padStart(2, '0');
  const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    weekday: weekdayNames[d.getDay()],
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function meetingRow(m, idx, includeRoom) {
  const start = splitDateTime(m.start_time);
  const end = splitDateTime(m.end_time);
  const row = { '序号': idx + 1, '日期': start.date, '星期': start.weekday };
  if (includeRoom) row['会议室'] = m.room_name;
  row['开始时间'] = start.time;
  row['结束时间'] = end.time;
  row['会议主题'] = m.topic;
  row['主持人/主讲人'] = m.host;
  row['联系电话/备注'] = m.contact || '';
  row['参会名单链接'] = m.attendee_link || '';
  return row;
}

// Builds the same "overview + one sheet per room" workbook shape as the
// admin UI's manual .xlsx export, but entirely server-side (no browser
// needed) so it can run automatically right before a destructive reset.
function buildWorkbook() {
  const rooms = db.prepare('SELECT id, name FROM rooms ORDER BY id ASC').all();
  const meetings = db.prepare(`
    SELECT m.id, m.room_id, r.name AS room_name, m.topic, m.host,
           m.start_time, m.end_time, m.attendee_link, m.contact
    FROM meetings m JOIN rooms r ON r.id = m.room_id
    ORDER BY m.start_time ASC
  `).all();

  const wb = XLSX.utils.book_new();
  const overviewRows = meetings.map((m, idx) => meetingRow(m, idx, true));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(overviewRows), '总览');

  const used = new Set(['总览']);
  rooms.forEach((room) => {
    const roomMeetings = meetings.filter((m) => m.room_id === room.id);
    if (!roomMeetings.length) return;
    const rows = roomMeetings.map((m, idx) => meetingRow(m, idx, false));
    let sheetName = sanitizeSheetName(room.name, `Room${room.id}`);
    while (used.has(sheetName)) sheetName = `${sheetName}_`;
    used.add(sheetName);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
  });

  return { workbook: wb, meetingCount: meetings.length };
}

function pruneOldBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.xlsx'))
    .map((f) => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  files.slice(MAX_BACKUPS).forEach((f) => {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f.name)); } catch (e) { /* best-effort */ }
  });
}

// Writes a timestamped snapshot to disk and returns its filename. Reused by
// both the "auto-backup right before /api/admin/reset" flow and, in the
// future, could be called from a cron-style scheduled backup if desired.
function writeBackupFile(reason) {
  const { workbook, meetingCount } = buildWorkbook();
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const safeReason = (reason || 'manual').replace(/[^a-zA-Z0-9-]/g, '');
  const filename = `backup_${stamp}_${safeReason}.xlsx`;
  XLSX.writeFile(workbook, path.join(BACKUP_DIR, filename));
  pruneOldBackups();
  return { filename, meetingCount };
}

function listBackups() {
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.xlsx'))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { filename: f, size: stat.size, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// Resolves a backup filename to a safe absolute path, rejecting anything
// that isn't a plain filename inside BACKUP_DIR (no path traversal via
// "../", no absolute paths) before any caller touches the filesystem with it.
function resolveBackupPath(filename) {
  const base = path.basename(String(filename || ''));
  if (!base || base !== filename || !base.endsWith('.xlsx')) return null;
  const full = path.join(BACKUP_DIR, base);
  if (!fs.existsSync(full)) return null;
  return full;
}

module.exports = { writeBackupFile, listBackups, resolveBackupPath, BACKUP_DIR };
