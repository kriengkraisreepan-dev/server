'use strict';

// A4 acceptance: Messenger webhook (S-5.1 signature, dedupe, S-3.7 window, S-3.8 rate limit,
// S-1.5 kill switch, handoff, staff echo), conversation log, Admin web chat API, S-6.2/S-6.3.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startHub, snapshot } = require('./helpers');

const APP_SECRET = 'test-app-secret-not-real';
const VERIFY_TOKEN = 'verify-me-123';
const PAGE_TOKEN = 'EAAG-test-page-token';
const APP_ID = '111222333';
const PSID = '24680135791113';

function sign(raw, secret = APP_SECRET) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

function fakeGraph() {
  const calls = [];
  let n = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ recipient_id: PSID, message_id: `m_out_${++n}` }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl, texts: () => calls.map((c) => c.body.message.text) };
}

async function setup(t, { extraConfig = {} } = {}) {
  const graph = fakeGraph();
  const h = await startHub({
    config: { fbAppSecret: APP_SECRET, fbVerifyToken: VERIFY_TOKEN, fbPageAccessToken: PAGE_TOKEN, fbAppId: APP_ID, ...extraConfig },
    deps: { fetchImpl: graph.fetchImpl },
  });
  t.after(() => h.close());
  const d = await h.onlineDevice();
  d.client.send('snapshot', snapshot(h.clock, 1));
  await d.client.flush();
  let mid = 0;
  const event = (text, { psid = PSID, ts = h.clock.now(), id = `m_in_${++mid}` } = {}) => ({
    object: 'page',
    entry: [{ id: 'PAGE', time: ts, messaging: [{ sender: { id: psid }, recipient: { id: 'PAGE' }, timestamp: ts, message: { mid: id, text } }] }],
  });
  /** POST a signed webhook and wait until it is processed. */
  const deliver = async (body, { signature } = {}) => {
    const raw = JSON.stringify(body);
    const r = await h.http('POST', '/webhooks/messenger', { body: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature === undefined ? sign(Buffer.from(raw)) : signature } });
    await h.hub.chat.idle();
    return r;
  };
  return { h, d, graph, event, deliver };
}

test('messenger webhook', async (t) => {
  await t.test('GET verify: right token echoes the challenge, wrong token 403', async (t) => {
    const { h } = await setup(t);
    const ok = await h.http('GET', `/webhooks/messenger?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`);
    assert.equal(ok.status, 200);
    assert.equal(ok.text, 'abc123');
    const bad = await h.http('GET', '/webhooks/messenger?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc123');
    assert.equal(bad.status, 403);
  });

  await t.test('S-5.1: wrong / missing signature → 401 and nothing is processed', async (t) => {
    const { graph, event, deliver, h } = await setup(t);
    assert.equal((await deliver(event('มีโต๊ะว่างไหม'), { signature: sign(Buffer.from('other'), APP_SECRET) })).status, 401);
    assert.equal((await deliver(event('มีโต๊ะว่างไหม'), { signature: sign(Buffer.from(JSON.stringify(event('x'))), 'wrong-secret') })).status, 401);
    assert.equal((await deliver(event('มีโต๊ะว่างไหม'), { signature: '' })).status, 401);
    assert.equal(graph.calls.length, 0);
    assert.equal((await h.hub.conversations.list()).length, 0);
    assert.ok(h.logger.has('fb.webhook_bad_signature'));
  });

  await t.test('no app secret configured → every POST is rejected', async (t) => {
    const { event, deliver } = await setup(t, { extraConfig: { fbAppSecret: null } });
    assert.equal((await deliver(event('hi'), { signature: sign(Buffer.from('x'), '') })).status, 401);
  });

  await t.test('valid message → AI answers from the snapshot; token only in the Authorization header', async (t) => {
    const { graph, event, deliver } = await setup(t);
    const r = await deliver(event('มีโต๊ะว่างไหมครับ'));
    assert.equal(r.status, 200);
    assert.equal(graph.calls.length, 1);
    const call = graph.calls[0];
    assert.match(call.url, /^https:\/\/graph\.facebook\.com\/v[\d.]+\/me\/messages$/);
    assert.ok(!call.url.includes(PAGE_TOKEN), 'token must not be in the URL (S-5.3)');
    assert.equal(call.headers.authorization, `Bearer ${PAGE_TOKEN}`);
    assert.equal(call.body.recipient.id, PSID);
    assert.equal(call.body.messaging_type, 'RESPONSE');
    const text = call.body.message.text;
    assert.match(text, /ผู้ช่วยอัตโนมัติของ 88 Snooker Club/, 'S-3.6 intro on a new conversation');
    assert.match(text, /ว่าง 1 โต๊ะ/);
  });

  await t.test('"changes" format (entry[].changes, field messages) is understood too', async (t) => {
    const { graph, deliver, h } = await setup(t);
    const ts = h.clock.now();
    const body = {
      object: 'page',
      entry: [{ id: 'PAGE', time: ts, changes: [{ field: 'messages', value: { sender: { id: PSID }, recipient: { id: 'PAGE' }, timestamp: String(Math.floor(ts / 1000)), message: { mid: 'm_changes_1', text: 'มีโต๊ะว่างไหมครับ' } } }] }],
    };
    assert.equal((await deliver(body)).status, 200);
    assert.equal(graph.calls.length, 1);
    assert.match(graph.texts()[0], /ว่าง 1 โต๊ะ/);
    const log = h.logger.events.find((e) => e.event === 'fb.webhook_received');
    assert.equal(log.events, 1);
    assert.deepEqual(log.fields, ['messages']);
  });

  await t.test('"changes" format: staff echo via field message_echoes → handoff', async (t) => {
    const { graph, event, deliver, h } = await setup(t);
    await deliver(event('ราคาเท่าไหร่'));
    const ts = h.clock.now();
    await deliver({ object: 'page', entry: [{ id: 'PAGE', time: ts, changes: [{ field: 'message_echoes', value: { sender: { id: 'PAGE' }, recipient: { id: PSID }, timestamp: ts, message: { mid: 'm_staff_c1', text: 'เดี๋ยวพนักงานดูให้ครับ' } } }] }] });
    const [conv] = await h.hub.conversations.list();
    assert.equal(conv.handoff, true);
    await deliver(event('ราคาเท่าไหร่'));
    assert.equal(graph.calls.length, 1, 'AI stays quiet after staff replied');
  });

  await t.test('duplicate webhook (same mid) is answered once', async (t) => {
    const { graph, event, deliver } = await setup(t);
    const ev = event('ราคาเท่าไหร่', { id: 'm_dup' });
    await deliver(ev);
    await deliver(ev);
    await deliver(ev);
    assert.equal(graph.calls.length, 1);
  });

  await t.test('S-3.7: message older than 24 h (late delivery) gets no reply', async (t) => {
    const { graph, event, deliver, h } = await setup(t);
    await deliver(event('ราคาเท่าไหร่', { ts: h.clock.now() - 25 * 60 * 60 * 1000 }));
    assert.equal(graph.calls.length, 0);
    assert.ok(h.logger.has('chat.outside_window'));
    assert.equal(await h.hub.adapter.canMessage(PSID), false);
    await deliver(event('ราคาเท่าไหร่'));
    assert.equal(await h.hub.adapter.canMessage(PSID), true);
    assert.equal(graph.calls.length, 1);
  });

  await t.test('S-3.8: more than 20 messages in 10 min → AI stops and the chat goes to staff', async (t) => {
    const { graph, event, deliver, h } = await setup(t);
    for (let i = 0; i < 21; i++) await deliver(event('ราคาเท่าไหร่'));
    assert.equal(graph.calls.length, 20);
    const [conv] = await h.hub.conversations.list();
    assert.equal(conv.handoff, true);
    assert.equal(conv.handoffReason, 'rate_limit');
    await deliver(event('ราคาเท่าไหร่'));
    assert.equal(graph.calls.length, 20);
  });

  await t.test('S-1.5: AI chat kill switch off → fixed fallback text, once per 30 min', async (t) => {
    const { graph, event, deliver, h } = await setup(t);
    await h.hub.killSwitches.set('ai_chat', false);
    await deliver(event('มีโต๊ะว่างไหม'));
    await deliver(event('ราคาเท่าไหร่'));
    assert.deepEqual(graph.texts(), ['ขอบคุณที่ทักมาครับ พนักงานจะตอบกลับโดยเร็วครับ']);
    h.clock.advance(31 * 60 * 1000);
    await deliver(event('hello?'));
    assert.equal(graph.calls.length, 2);
    assert.match(graph.texts()[1], /staff member will reply soon/);
    await h.hub.killSwitches.set('ai_chat', true);
    await deliver(event('ราคาเท่าไหร่'));
    assert.match(graph.texts()[2], /120 บาท/);
  });

  await t.test('handoff (booking) → staff message, AI silent until released', async (t) => {
    const { graph, event, deliver, h } = await setup(t);
    await deliver(event('ขอจองโต๊ะคืนนี้ 2 ทุ่มครับ'));
    assert.match(graph.texts()[0], /ยังรับจองผ่านแชทไม่ได้/);
    assert.doesNotMatch(graph.texts()[0], /จองให้แล้ว|ยืนยัน/);
    await deliver(event('ราคาเท่าไหร่'));
    assert.equal(graph.calls.length, 1, 'AI does not answer while staff handle the chat');
    const [conv] = await h.hub.conversations.list();
    assert.equal(conv.handoffReason, 'booking');
    assert.equal(await h.hub.conversations.countHandoff(), 1);
    await h.hub.conversations.release(conv.id);
    await deliver(event('ราคาเท่าไหร่'));
    assert.equal(graph.calls.length, 2);
  });

  await t.test('staff reply from the Page inbox (echo, not our app) → AI stops for that chat', async (t) => {
    const { graph, event, deliver, h } = await setup(t);
    await deliver(event('ราคาเท่าไหร่'));
    const echo = (appId, mid) => ({
      object: 'page',
      entry: [{ id: 'PAGE', time: h.clock.now(), messaging: [{ sender: { id: 'PAGE' }, recipient: { id: PSID }, timestamp: h.clock.now(), message: { mid, is_echo: true, app_id: appId, text: 'สวัสดีครับ พนักงานเองครับ' } }] }],
    });
    await deliver(echo(Number(APP_ID), 'm_out_1')); // our own reply echoed back → ignored
    let [conv] = await h.hub.conversations.list();
    assert.equal(conv.handoff, false);
    await deliver(echo(999, 'm_staff_1')); // a human in the Page inbox
    [conv] = await h.hub.conversations.list();
    assert.equal(conv.handoff, true);
    assert.equal(conv.handoffReason, 'staff_replied');
    await deliver(event('มีโปรไหม'));
    assert.equal(graph.calls.length, 1);
  });

  await t.test('stale snapshot → reply states the data time (S-3.5)', async (t) => {
    const { graph, event, deliver, h } = await setup(t);
    h.clock.advance(5 * 60 * 1000); // device sends nothing for 5 minutes
    await deliver(event('มีโต๊ะว่างไหม'));
    assert.match(graph.texts()[0], /ข้อมูล ณ 22:00 น\./);
  });

  await t.test('conversation log + admin API: list, detail, handoff/release, delete (S-6.3)', async (t) => {
    const { event, deliver, h } = await setup(t);
    await deliver(event('ราคาเท่าไหร่'));
    const admin = await h.adminLogin();
    const list = await admin('GET', '/conversations');
    assert.equal(list.status, 200);
    assert.equal(list.json.conversations.length, 1);
    const c = list.json.conversations[0];
    assert.equal(c.customerRef, undefined, 'PSID is not sent to the browser');
    assert.equal(c.customerLabel, '…' + PSID.slice(-4));
    const detail = await admin('GET', `/conversations/${c.id}`);
    assert.deepEqual(detail.json.messages.map((m) => m.role), ['customer', 'ai']);
    assert.equal((await admin('POST', `/conversations/${c.id}/handoff`)).status, 200);
    assert.equal((await admin('GET', '/chat/summary')).json.handoffCount, 1);
    assert.equal((await admin('GET', '/conversations?handoff=1')).json.conversations.length, 1);
    assert.equal((await admin('POST', `/conversations/${c.id}/release`)).status, 200);
    assert.equal((await admin('DELETE', `/conversations/${c.id}`)).status, 200);
    assert.equal((await admin('GET', '/conversations')).json.conversations.length, 0);
    const audit = (await h.hub.audit.recent(20)).map((e) => e.action);
    assert.ok(audit.includes('chat.deleted'));
  });

  await t.test('S-6.2: messages older than 90 days are purged', async (t) => {
    const { event, deliver, h } = await setup(t);
    await deliver(event('ราคาเท่าไหร่'));
    h.clock.advance(91 * 24 * 60 * 60 * 1000);
    const r = await h.hub.conversations.purgeOld();
    assert.equal(r.messages, 2);
    assert.equal(r.conversations, 1);
  });

  await t.test('logs never contain the page token or the app secret (S-5.3)', async (t) => {
    const { event, deliver, h } = await setup(t);
    await deliver(event('ราคาเท่าไหร่'));
    await deliver(event('x'), { signature: 'sha256=00' });
    const all = JSON.stringify(h.logger.events);
    assert.ok(!all.includes(PAGE_TOKEN));
    assert.ok(!all.includes(APP_SECRET));
  });
});

test('admin web: shop info, FAQ, try-it box', async (t) => {
  const { h } = await setup(t);
  const admin = await h.adminLogin();

  await t.test('shop info: known keys only, saved, audited', async () => {
    assert.equal((await admin('PUT', '/shop-info', { nope: 'x' })).status, 400);
    const r = await admin('PUT', '/shop-info', { address: '88 ถนนตัวอย่าง', directions: 'จอดรถได้หน้าร้าน' });
    assert.equal(r.status, 200);
    assert.equal((await admin('GET', '/shop-info')).json.values.address, '88 ถนนตัวอย่าง');
  });

  await t.test('FAQ: create, search by keyword, edit, delete', async () => {
    const c = await admin('POST', '/faq', { question: 'เอาไม้คิวมาเองได้ไหม', answer: 'นำไม้คิวส่วนตัวมาได้เลยครับ', keywords: 'ไม้คิว, cue' });
    assert.equal(c.status, 201);
    assert.equal((await admin('POST', '/faq', { question: '', answer: 'x' })).status, 400);
    assert.equal((await h.hub.knowledge.searchFaq('เอาไม้คิวไปเองได้มั้ย')).length, 1);
    assert.equal((await h.hub.knowledge.searchFaq('can I bring my own cue')).length, 1);
    assert.equal((await admin('PUT', `/faq/${c.json.id}`, { answer: 'ได้ครับ' })).status, 200);
    assert.equal((await admin('GET', '/faq')).json.faq[0].answer, 'ได้ครับ');
    assert.equal((await admin('DELETE', `/faq/${c.json.id}`)).status, 200);
    assert.equal((await admin('GET', '/faq')).json.faq.length, 0);
  });

  await t.test('try-it box uses the same agent and does not appear in the customer list', async () => {
    const r = await admin('POST', '/chat/try', { text: 'ราคาเท่าไหร่' });
    assert.equal(r.status, 200);
    assert.match(r.json.reply, /120 บาท/);
    const b = await admin('POST', '/chat/try', { text: 'ขอคุยกับพนักงานหน่อย' });
    assert.equal(b.json.handoff, 'asked_for_human');
    assert.equal((await admin('GET', '/conversations')).json.conversations.length, 0);
    assert.equal((await admin('GET', '/chat/summary')).json.handoffCount, 0);
    await admin('POST', '/chat/try/reset');
    assert.match((await admin('POST', '/chat/try', { text: 'มีโต๊ะว่างไหม' })).json.reply, /ว่าง/);
  });

  await t.test('chat API needs login', async () => {
    for (const p of ['/conversations', '/faq', '/shop-info', '/chat/summary']) {
      assert.equal((await h.http('GET', '/admin/api' + p, { headers: { 'x-hub-admin': '1' } })).status, 401, p);
    }
  });
});
