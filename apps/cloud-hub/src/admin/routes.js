'use strict';

// Admin web API for the shop owner: login, "เครื่องร้าน" (pairing code, status, revoke,
// rotate token), kill switches (S-1.5), recent audit log.
const path = require('node:path');
const express = require('express');
const auth = require('./auth');

const ADMIN_HEADER = 'x-hub-admin';

function adminRouter({ config, clock, devices, snapshots, bridge, killSwitches, audit, loginLimiter, knowledge, conversations, chatTester, aiInfo = {} }) {
  const router = express.Router();
  const sessions = auth.createSessions({ clock });
  const secure = config.secureCookies;

  router.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; form-action 'self'",
    });
    next();
  });

  router.use('/', express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

  const api = express.Router();
  api.use(express.json({ limit: '8kb' }));

  // CSRF: the session cookie is SameSite=Strict, and every API call must carry a custom
  // header, which a cross-site form or image cannot send without a CORS preflight.
  api.use((req, res, next) => {
    if (req.get(ADMIN_HEADER) !== '1') return res.status(403).json({ error: 'missing_admin_header' });
    next();
  });

  api.post('/login', async (req, res) => {
    if (!loginLimiter.hit(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
    if (!config.adminPasswordHash || !auth.verifyPassword(password, config.adminPasswordHash)) {
      await audit.record({ actor: 'system', action: 'admin.login_failed', detail: { ip: req.ip } });
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    loginLimiter.reset(req.ip);
    const sid = sessions.create();
    await audit.record({ actor: 'owner', action: 'admin.login', detail: { ip: req.ip } });
    res.set('Set-Cookie', auth.sessionCookie(sid, { secure })).json({ ok: true });
  });

  // Everything below needs a valid owner session.
  api.use((req, res, next) => {
    const sid = auth.parseCookies(req.headers.cookie)[auth.COOKIE_NAME];
    if (!sessions.valid(sid)) return res.status(401).json({ error: 'not_logged_in' });
    req.sid = sid;
    next();
  });

  api.post('/logout', (req, res) => {
    sessions.destroy(req.sid);
    res.set('Set-Cookie', auth.clearCookie({ secure })).json({ ok: true });
  });

  api.get('/me', (req, res) => res.json({ role: 'owner' }));

  api.get('/devices', async (req, res) => {
    const list = await devices.list();
    const out = [];
    for (const d of list) {
      const latest = d.revokedAt ? null : await snapshots.latest(d.deviceId);
      out.push({
        ...d,
        online: !d.revokedAt && bridge.isOnline(d.deviceId),
        snapshot: latest ? { seq: latest.seq, asOf: latest.asOf, stale: latest.stale } : null,
      });
    }
    res.json({ devices: out });
  });

  api.post('/pairing-codes', async (req, res) => {
    if (!(await killSwitches.isEnabled('bridge'))) return res.status(409).json({ error: 'bridge_disabled' });
    res.status(201).json(await devices.createPairingCode('owner'));
  });

  api.post('/devices/:deviceId/revoke', async (req, res) => {
    const ok = await devices.revoke(req.params.deviceId, 'owner');
    if (!ok) return res.status(404).json({ error: 'not_found' });
    // Close the live connection right away; the token can no longer authenticate.
    bridge.disconnect(req.params.deviceId);
    res.json({ ok: true });
  });

  api.post('/devices/:deviceId/rotate-token', async (req, res) => {
    const r = await bridge.rotateToken(req.params.deviceId, 'owner');
    if (!r.rotated) return res.status(404).json({ error: 'not_found' });
    res.json(r);
  });

  api.get('/kill-switches', async (req, res) => res.json({ killSwitches: await killSwitches.all() }));

  api.put('/kill-switches/:name', async (req, res) => {
    if (!killSwitches.names.includes(req.params.name)) return res.status(404).json({ error: 'not_found' });
    if (!req.body || typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'enabled_must_be_boolean' });
    await killSwitches.set(req.params.name, req.body.enabled, 'owner');
    res.json({ killSwitches: await killSwitches.all() });
  });

  api.get('/audit', async (req, res) => res.json({ entries: await audit.recent(Number(req.query.limit) || 50) }));

  // ---- A4: AI chat (shop info, FAQ, conversations, handoff, try-it box) ----
  const { KnowledgeError } = require('../chat/knowledge');
  const knowledgeError = (res, err) => {
    if (err instanceof KnowledgeError) return res.status(400).json({ error: err.code });
    throw err;
  };

  api.get('/chat/summary', async (req, res) => {
    res.json({
      ai: aiInfo,
      handoffCount: await conversations.countHandoff(),
      aiChatEnabled: await killSwitches.isEnabled('ai_chat'),
    });
  });

  api.get('/shop-info', async (req, res) => res.json({ fields: knowledge.SHOP_INFO_KEYS, values: await knowledge.getShopInfo() }));
  api.put('/shop-info', async (req, res) => {
    try {
      res.json({ values: await knowledge.setShopInfo(req.body, 'owner') });
    } catch (err) { knowledgeError(res, err); }
  });

  api.get('/faq', async (req, res) => res.json({ faq: await knowledge.listFaq() }));
  api.post('/faq', async (req, res) => {
    try {
      const { question, answer, keywords, enabled } = req.body || {};
      res.status(201).json({ id: await knowledge.upsertFaq({ question, answer, keywords, enabled }, 'owner') });
    } catch (err) { knowledgeError(res, err); }
  });
  api.put('/faq/:id', async (req, res) => {
    try {
      const existing = (await knowledge.listFaq()).find((f) => f.id === req.params.id);
      if (!existing) return res.status(404).json({ error: 'not_found' });
      const { question, answer, keywords, enabled } = { ...existing, ...(req.body || {}) };
      res.json({ id: await knowledge.upsertFaq({ id: existing.id, question, answer, keywords, enabled }, 'owner') });
    } catch (err) { knowledgeError(res, err); }
  });
  api.delete('/faq/:id', async (req, res) => {
    if (!(await knowledge.deleteFaq(req.params.id, 'owner'))) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  api.get('/conversations', async (req, res) => {
    res.json({ conversations: await conversations.list({ limit: Number(req.query.limit) || 50, handoffOnly: req.query.handoff === '1' }) });
  });
  api.get('/conversations/:id', async (req, res) => {
    const c = await conversations.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'not_found' });
    const messages = await conversations.recentMessages(c.id, 200);
    res.json({
      conversation: { ...c, customerRef: undefined },
      messages: messages.map((m) => ({ at: m.at, role: m.role, text: m.text, kind: m.meta && m.meta.kind, sent: m.meta && m.meta.sent })),
    });
  });
  api.post('/conversations/:id/handoff', async (req, res) => {
    if (!(await conversations.get(req.params.id))) return res.status(404).json({ error: 'not_found' });
    await conversations.setHandoff(req.params.id, 'owner', 'owner');
    res.json({ ok: true });
  });
  api.post('/conversations/:id/release', async (req, res) => {
    if (!(await conversations.release(req.params.id, 'owner'))) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });
  // S-6.3: a customer asked for their data to be deleted.
  api.delete('/conversations/:id', async (req, res) => {
    if (!(await conversations.remove(req.params.id, 'owner'))) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  // "ลองถาม AI": the owner chats with the agent here, without Facebook. Same agent + guards.
  api.post('/chat/try', async (req, res) => {
    const text = req.body && typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 1000) : '';
    if (!text) return res.status(400).json({ error: 'text_required' });
    res.json(await chatTester.ask(text));
  });
  api.post('/chat/try/reset', async (req, res) => {
    await chatTester.reset();
    res.json({ ok: true });
  });

  router.use('/api', api);
  return router;
}

module.exports = { adminRouter, ADMIN_HEADER };
