const path = require('path');
const os = require('os');
const express = require('express');
const cors = require('cors');

require('./db'); // initialize DB + schema on boot
const roomsRouter = require('./routes/rooms');
const meetingsRouter = require('./routes/meetings');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/rooms', roomsRouter);
app.use('/api/meetings', meetingsRouter);
app.use('/api/admin', adminRouter);

// A short human-readable build tag, bumped whenever this file changes in a
// release. Exposed at /api/health and shown as a tiny footer marker in the
// admin/guest/signage UIs — the point is purely diagnostic: if the site's
// displayed version doesn't match what you expect after a deploy, that's
// immediate proof the deploy didn't actually land (or the browser/CDN is
// still serving a cached copy), rather than having to guess.
const BUILD_VERSION = '2026-09-18.1';

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString(), version: BUILD_VERSION }));
// Plain, unauthenticated liveness probe at a conventional path, so an
// external "keep this Render Starter instance warm" pinger (UptimeRobot,
// cron-job.org, etc.) can hit it without knowing anything about /api.
app.get('/healthz', (req, res) => res.status(200).send('ok'));

// Lets the admin page build a shareable LAN URL (and QR code) for guests to
// scan, without anyone having to look up their own IP manually.
app.get('/api/server-info', (req, res) => {
  const addresses = [];
  const nets = os.networkInterfaces();
  Object.values(nets).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    });
  });
  res.json({ addresses, port: PORT });
});

// Friendlier URL for the QR code / guest link than /guest.html
app.get('/guest', (req, res) => res.redirect('/guest.html'));
// Full-screen, sidebar-free kanban meant for a door-mounted iPad/TV.
app.get('/signage', (req, res) => res.redirect('/signage.html'));

// Centralized error handler so a thrown error in any route never leaves a
// request hanging or crashes the process.
app.use((err, req, res, next) => {
  console.error('[unhandled route error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`会议室排期系统已启动: http://localhost:${PORT}`);
  console.log(`嘉宾预约页面: http://localhost:${PORT}/guest`);
  console.log(`门头看板模式: http://localhost:${PORT}/signage`);
});

// Belt-and-suspenders: never let an unexpected async error kill the whole
// server outright; log it and keep serving.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
