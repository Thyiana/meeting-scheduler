const path = require('path');
const os = require('os');
const express = require('express');
const cors = require('cors');

require('./db'); // initialize DB + schema on boot
const roomsRouter = require('./routes/rooms');
const meetingsRouter = require('./routes/meetings');
const icalRouter = require('./routes/ical');
const { startIcalCron } = require('./cron');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/rooms', roomsRouter);
app.use('/api/meetings', meetingsRouter);
app.use('/api/ical-sources', icalRouter);

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

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
  startIcalCron();
});

// Belt-and-suspenders: never let an unexpected async error kill the whole
// server outright; log it and keep serving.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
