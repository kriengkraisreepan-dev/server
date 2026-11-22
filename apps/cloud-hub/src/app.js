'use strict';

// Composition root: wires the database, bridge and admin web into one HTTP server.
const http = require('node:http');
const express = require('express');
const { openDatabase, migrate } = require('./db');
const { createAudit } = require('./audit');
const { createKillSwitches } = require('./kill-switches');
const { createRateLimiter } = require('./rate-limit');
const { createDevices, PairingError } = require('./bridge/devices');
const { createSnapshots } = require('./bridge/snapshots');
const { createBridgeServer, CLOSE } = require('./bridge/ws-server');
const { adminRouter } = require('./admin/routes');
const { createLogger } = require('./logger');

const HOUR = 60 * 60 * 1000;

/**
 * @param {object} config see src/config.js
 * @param {{ db?: object, clock?: { now(): number }, logger?: object, bridgeOptions?: object }} [deps]
 */
async function createHub(config, deps = {}) {
  const clock = deps.clock || { now: () => Date.now() };
  const logger = deps.logger || createLogger();
  const db = deps.db || (await openDatabase({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir }));
  await migrate(db);

  const audit = createAudit({ db, clock });
  const devices = createDevices({ db, audit, clock, hubUrl: config.publicWsUrl });
  let bridge = null;
  const snapshots = createSnapshots({ db, clock, isOnline: (id) => Boolean(bridge && bridge.isOnline(id)) });
  const killSwitches = createKillSwitches({
    db,
    audit,
    clock,
    onChange: (name, enabled) => {
      if (name === 'bridge' && !enabled) bridge.disconnectAll(CLOSE.BRIDGE_DISABLED, 'bridge disabled');
    },
  });
  bridge = createBridgeServer({
    devices,
    snapshots,
    audit,
    killSwitches,
    logger,
    onDecision: (deviceId, msg) =>
      // Only ids and enums: `note` and `editedPayload` may contain customer text.
      audit.record({
        actor: `device:${deviceId}`,
        action: 'approval.decision.received',
        target: msg.payload.approvalId,
        detail: { decision: msg.payload.decision, reasonCode: msg.payload.reasonCode, messageId: msg.id },
      }),
    ...(deps.bridgeOptions || {}),
  });

  // §2.7: 5 pair attempts per hour per IP.
  const pairLimiter = createRateLimiter({ limit: 5, windowMs: HOUR, clock });
  const loginLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000, clock });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.post('/bridge/v1/pair', express.json({ limit: '4kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!pairLimiter.hit(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    if (!(await killSwitches.isEnabled('bridge'))) return res.status(503).json({ error: 'bridge_disabled' });
    try {
      res.json(await devices.pair(req.body, { ip: req.ip }));
    } catch (err) {
      if (err instanceof PairingError) return res.status(err.status).json({ error: err.code });
      throw err;
    }
  });

  app.use('/admin', adminRouter({ config, clock, devices, snapshots, bridge, killSwitches, audit, loginLimiter }));
  app.get('/', (req, res) => res.redirect('/admin/'));

  // Body-parser errors (bad JSON, too large) → 400/413 without echoing input.
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    logger.error('http.error', { path: req.path, error: err && err.message });
    res.status(500).json({ error: 'internal_error' });
  });

  const server = http.createServer(app);
  server.on('upgrade', (req, socket, head) => bridge.handleUpgrade(req, socket, head));

  return {
    app,
    server,
    db,
    bridge,
    devices,
    snapshots,
    killSwitches,
    audit,
    listen(port = config.port, host = config.host) {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
    },
    async close() {
      bridge.close();
      await new Promise((resolve) => server.close(() => resolve()));
      if (!deps.db) await db.close();
    },
  };
}

module.exports = { createHub };
