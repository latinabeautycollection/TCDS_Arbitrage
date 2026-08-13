/* Domain 10 email workers runner — drives the three batch functions on intervals. */
require('dotenv').config();
const path = require('node:path');
const D = p => require(path.join(process.cwd(), 'dist/domains/operations/workers', p));
const { runEmailDeliveryBatch } = D('emailDeliveryWorker.js');
const { runRetryWorker } = D('emailRetryWorker.js');
const { runEmailReconciliationWorker } = D('emailReconciliationWorker.js');

const DELIVERY_MS   = Number(process.env.EMAIL_DELIVERY_INTERVAL_MS   || 15000);
const RETRY_MS      = Number(process.env.EMAIL_RETRY_INTERVAL_MS      || 60000);
const RECONCILE_MS  = Number(process.env.EMAIL_RECONCILE_INTERVAL_MS  || 300000);

const log = (m, extra) => console.log(JSON.stringify({ ts: new Date().toISOString(), runner: 'email-workers', ...m, ...(extra||{}) }));
let stopping = false;

function loop(name, fn, intervalMs) {
  let inFlight = false;
  const tick = async () => {
    if (stopping || inFlight) return;
    inFlight = true;
    try {
      const r = await fn();
      if (typeof r === 'number' && r > 0) log({ worker: name, processed: r });
    } catch (e) {
      log({ worker: name, error: (e && e.message) || String(e) });
    } finally {
      inFlight = false;
    }
  };
  tick();
  return setInterval(tick, intervalMs);
}

log({ msg: 'starting', enabled: process.env.DOMAIN10_EMAIL_ENABLED, env: process.env.DOMAIN10_ENVIRONMENT,
      intervals: { DELIVERY_MS, RETRY_MS, RECONCILE_MS } });

const timers = [
  loop('delivery',       runEmailDeliveryBatch,          DELIVERY_MS),
  loop('retry',          runRetryWorker,                 RETRY_MS),
  loop('reconciliation', runEmailReconciliationWorker,   RECONCILE_MS),
];

const shutdown = sig => { log({ msg: 'shutting down', signal: sig }); stopping = true; timers.forEach(clearInterval); setTimeout(() => process.exit(0), 2000); };
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
