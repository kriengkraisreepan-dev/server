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
const { createKnowledge } = require('./chat/knowledge');
const { createConversations } = require('./chat/conversations');
const { createChatService } = require('./chat/service');
const { createMessengerAdapter } = require('./channels/fb-messenger');
const { messengerWebhookRouter } = require('./channels/webhook-routes');
const { createToolRunner } = require('./agent/tools');
const { createAgent } = require('./agent/agent');
const { createRulesProvider } = require('./agent/llm-rules');
const { createAssets } = require('./content/assets');
const { createRenderer } = require('./content/renderer');
const { TEMPLATE_IDS } = require('./content/templates');

const HOUR = 60 * 60 * 1000;

/**
 * @param {object} config see src/config.js
 * @param {{ db?: object, clock?: { now(): number }, logger?: object, bridgeOptions?: object,
 *           aiProvider?: object, fetchImpl?: typeof fetch, renderer?: object }} [deps]
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

  // A4: Messenger + chat agent.
  const knowledge = createKnowledge({ db, audit, clock });
  const conversations = createConversations({ db, audit, clock, retentionDays: config.chatRetentionDays || 90 });
  const adapter = createMessengerAdapter({
    pageAccessToken: config.fbPageAccessToken,
    appSecret: config.fbAppSecret,
    pageAppId: config.fbAppId,
    clock,
    logger,
    fetchImpl: deps.fetchImpl,
    lastInboundAt: async (customerRef) => {
      const c = await conversations.getOrCreate(adapter.channel, customerRef);
      return c.lastInboundAt;
    },
  });
  const aiProvider = deps.aiProvider || makeProvider(config, logger);
  const agent = createAgent({ provider: aiProvider, runTool: createToolRunner({ snapshots, knowledge, clock }), conversations, clock, logger });
  const chat = createChatService({ adapter, agent, conversations, killSwitches, audit, clock, logger });
  const chatTester = createChatTester({ agent, conversations, killSwitches });
  const purgeTimer = setInterval(() => conversations.purgeOld().catch((e) => logger.error('chat.purge_failed', { error: e.message })), 6 * HOUR);
  purgeTimer.unref();

  // A5: asset library + post renderer.
  const assets = createAssets({ db, audit, clock, templateIds: TEMPLATE_IDS });
  const renderer = deps.renderer || createRenderer({ executablePath: config.chromiumPath, logger });

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

  // BRIDGE_PROTOCOL §2 "Disconnect จากฝั่งร้าน": the Shop deletes its token and tells the Cloud
  // (best effort, when online). Bearer = the device's own token; result = the same as an owner revoke.
  const unpairLimiter = createRateLimiter({ limit: 20, windowMs: HOUR, clock });
  app.post('/bridge/v1/unpair', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!unpairLimiter.hit(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(String(req.headers.authorization || '').trim());
    const device = m ? await devices.authenticate(m[1]) : null;
    if (!device) return res.status(401).json({ error: 'unauthorized' });
    await devices.revoke(device.deviceId, `device:${device.deviceId}`);
    bridge.disconnect(device.deviceId);
    res.json({ ok: true });
  });

  // Echoes need FB_APP_ID to tell our own replies from staff replies; without it they are ignored.
  const webhookChat = { handleWebhook: (body) => chat.handleWebhook(body, { echoesEnabled: Boolean(config.fbAppId) }) };
  app.use('/webhooks/messenger', messengerWebhookRouter({ adapter, chat: webhookChat, verifyToken: config.fbVerifyToken, logger }));

  app.use('/admin', adminRouter({ config, clock, devices, snapshots, bridge, killSwitches, audit, loginLimiter, knowledge, conversations, chatTester, assets, renderer, aiInfo: { provider: aiProvider.name, model: aiProvider.model, messengerConfigured: adapter.configured } }));
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
    knowledge,
    conversations,
    chat,
    adapter,
    assets,
    renderer,
    listen(port = config.port, host = config.host) {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
    },
    async close() {
      clearInterval(purgeTimer);
      await chat.idle();
      bridge.close();
      await new Promise((resolve) => server.close(() => resolve()));
      if (!deps.db) await db.close();
    },
  };
}

/** Admin web "ลองถาม AI": the same agent and guards, in a private test conversation. */
function createChatTester({ agent, conversations, killSwitches }) {
  const CH = 'admin_test';
  return {
    async ask(text) {
      const conv = await conversations.getOrCreate(CH, 'owner');
      await conversations.addMessage(conv.id, { role: 'customer', text });
      if (conv.handoff) return { reply: null, handoff: conv.handoffReason, kind: 'staff_handling' };
      if (!(await killSwitches.isEnabled('ai_chat'))) {
        const reply = agent.TEXT.th.killSwitch;
        await conversations.addMessage(conv.id, { role: 'ai', text: reply, meta: { kind: 'kill_switch' } });
        return { reply, handoff: null, kind: 'kill_switch' };
      }
      const r = await agent.respond(conv, { text });
      if (r.handoff) await conversations.setHandoff(conv.id, r.handoff, 'owner_test');
      if (r.reply) await conversations.addMessage(conv.id, { role: 'ai', text: r.reply, meta: { kind: r.kind, handoff: r.handoff } });
      return { reply: r.reply, handoff: r.handoff, kind: r.kind, tools: (r.meta && r.meta.tools) || [] };
    },
    async reset() {
      const conv = await conversations.getOrCreate(CH, 'owner');
      await conversations.remove(conv.id, 'owner');
    },
  };
}

function makeProvider(config, logger) {
  if (config.aiProvider === 'claude' && config.anthropicApiKey) {
    const { createClaudeProvider, DEFAULT_MODEL } = require('./agent/llm-claude');
    return createClaudeProvider({ apiKey: config.anthropicApiKey, model: config.aiModel || DEFAULT_MODEL, effort: config.aiEffort, logger });
  }
  return createRulesProvider();
}

module.exports = { createHub };
