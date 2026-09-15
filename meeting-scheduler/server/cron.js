const cron = require('node-cron');
const { syncAllSources } = require('./icalSync');

// Every 15 minutes. Adjust the expression as needed.
const SCHEDULE = '*/15 * * * *';

let syncing = false;

function startIcalCron() {
  cron.schedule(SCHEDULE, () => {
    if (syncing) return; // skip overlapping runs instead of queueing up
    syncing = true;
    // setImmediate ensures this is scheduled as a new event-loop tick,
    // never sharing a call stack with an in-flight HTTP request handler.
    setImmediate(async () => {
      try {
        await syncAllSources();
      } catch (err) {
        console.error('[ical-cron] sync batch failed:', err.message);
      } finally {
        syncing = false;
      }
    });
  });
  console.log(`[ical-cron] scheduled with pattern "${SCHEDULE}"`);
}

module.exports = { startIcalCron };
