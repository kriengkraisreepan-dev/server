'use strict';

// A6 acceptance: generator + approval queue (PHASE_A_TASKS A6, CONTENT_PIPELINE §3–6,
// S-4.1 L1 only, S-4.2 numbers trace to sourceSnapshot, S-4.4 expiresAt, brand voice §4.3).
// The 88Snooker Approval tab over the bridge is a separate change.
const test = require('node:test');
const assert = require('node:assert/strict');
const { PNG } = require('pngjs');
const { startHub, snapshot, makeClock } = require('./helpers');
const generator = require('../src/content/generator');
const checks = require('../src/content/checks');
const templates = require('../src/content/templates');
const { canTransition, TRANSITIONS } = require('../src/content/items');

const MIN = 60 * 1000;

const TABLES = [
  { tableNo: '1', kind: 'snooker', status: 'available' },
  { tableNo: '2', kind: 'snooker', status: 'available' },
  { tableNo: '3', kind: 'snooker', status: 'in_use', elapsedMin: 40 },
  { tableNo: '5', kind: 'pool', status: 'available' },
];
const PROMO = {
  id: 'promo_afternoon',
  title: 'บ่ายสบาย ราคาพิเศษ',
  detail: 'โต๊ะสนุกเกอร์ชั่วโมงละ 80 บาท',
  validFrom: '2026-11-01',
  validTo: '2026-12-31',
  days: [1, 2, 3, 4, 5],
  timeRange: '13:00-17:00',
};

function shopSnapshot(clock, seq = 1, extra = {}) {
  return snapshot(clock, seq, {
    tables: TABLES,
    priceList: [{ kind: 'snooker', label: 'ปกติ', pricePerHourTHB: 120 }, { kind: 'pool', label: 'ปกติ', pricePerHourTHB: 90 }],
    promotions: [PROMO],
    ...extra,
  });
}

/** A snapshots.latestActive()-shaped record, for the pure generator tests. */
function rec(clock, extra = {}, { stale = false } = {}) {
  const s = shopSnapshot(clock, 7, extra);
  return { seq: s.seq, asOf: s.generatedAt, stale, online: true, snapshot: s };
}

function fakePng() {
  return PNG.sync.write(new PNG({ width: 4, height: 4 }));
}

async function hubWithShop(t, extra = {}) {
  const calls = [];
  const renderer = {
    async render(templateId, data, options) {
      templates.validate(templateId, data); // the real template validation
      calls.push({ templateId, data, options });
      return { png: fakePng() };
    },
  };
  const h = await startHub({ deps: { renderer } });
  t.after(() => h.close());
  const d = await h.onlineDevice();
  d.client.send('snapshot', shopSnapshot(h.clock, 1, extra));
  await d.client.flush();
  const admin = await h.adminLogin();
  return { h, d, admin, calls };
}

// ---------- generator (pure) ----------

test('daily_tables: caption, hashtags, image prompt and data come from the snapshot', () => {
  const clock = makeClock(); // 22:00 Bangkok → "คืนนี้"
  const r = rec(clock);
  const draft = generator.dailyTables(r, { now: clock.now() });
  assert.equal(draft.templateId, 'daily_tables');
  assert.equal(draft.templateData.available, 3);
  assert.equal(draft.templateData.variant, 'tonight');
  assert.match(draft.caption, /คืนนี้โต๊ะว่าง 3 โต๊ะ/);
  assert.match(draft.caption, /สนุกเกอร์ 2 โต๊ะ · พูล 1 โต๊ะ/);
  assert.match(draft.caption, /เริ่ม 90 บาท/);
  assert.match(draft.caption, /ข้อมูล ณ 22:00 น\./);
  assert.match(draft.caption, /ทักแชทเพจเพื่อจองโต๊ะ$/);
  assert.ok(draft.hashtags.includes('#88SnookerClub'));
  assert.match(draft.imagePrompt, /NO text, NO letters, NO numbers, NO logos, NO people, NO faces/);
  assert.deepEqual(draft.sourceSnapshot.data, r.snapshot);
  assert.equal(draft.sourceSnapshot.seq, 7);
  // S-4.4: 60 minutes.
  assert.equal(Date.parse(draft.expiresAt), clock.now() + 60 * MIN);
  assert.deepEqual(checks.checkDraft(draft), []);
  templates.validate('daily_tables', draft.templateData);
});

test('daily_tables: daytime wording, and another wording for "ร่างใหม่"', () => {
  const clock = makeClock(Date.parse('2026-11-23T06:00:00Z')); // 13:00 Bangkok
  const a = generator.dailyTables(rec(clock), { now: clock.now(), variant: 0 });
  const b = generator.dailyTables(rec(clock), { now: clock.now(), variant: 1 });
  assert.equal(a.templateData.variant, 'now');
  assert.match(a.caption, /ว่างตอนนี้ 3 โต๊ะ/);
  assert.notEqual(a.caption, b.caption);
  assert.deepEqual(checks.checkDraft(b), []);
});

test('daily_tables is only made when the shop is open, has ≥ 2 free tables and fresh data (§5 T1)', () => {
  const clock = makeClock();
  const now = clock.now();
  assert.throws(() => generator.dailyTables(null, { now }), { code: 'no_shop_data' });
  assert.throws(() => generator.dailyTables(rec(clock, {}, { stale: true }), { now }), { code: 'shop_data_stale' });
  assert.throws(() => generator.dailyTables(rec(clock, { shop: { isOpenNow: false, todayHours: null } }), { now }), { code: 'shop_closed' });
  const oneFree = TABLES.map((t, i) => (i === 0 ? t : { ...t, status: 'in_use', elapsedMin: 10 }));
  assert.throws(() => generator.dailyTables(rec(clock, { tables: oneFree }), { now }), { code: 'not_enough_tables' });
});

test('happy_hour: everything about the promotion comes from promotions; expires at the end of validTo', () => {
  const clock = makeClock();
  const draft = generator.happyHour(rec(clock), PROMO.id, { now: clock.now() });
  assert.match(draft.caption, /บ่ายสบาย ราคาพิเศษ/);
  assert.match(draft.caption, /ชั่วโมงละ 80 บาท/);
  assert.match(draft.caption, /จันทร์–ศุกร์ 13:00-17:00 น\./);
  assert.match(draft.caption, /ถึง 31 ธ\.ค\. 2569/);
  assert.equal(draft.expiresAt, '2026-12-31T16:59:59.999Z'); // 23:59:59 Bangkok
  assert.equal(draft.sourceSnapshot.promotionId, PROMO.id);
  assert.deepEqual(checks.checkDraft(draft), []);
  templates.validate('happy_hour', draft.templateData);
  assert.throws(() => generator.happyHour(rec(clock), 'nope', { now: clock.now() }), { code: 'promotion_not_found' });
  const ended = { ...PROMO, validTo: '2026-11-01' };
  assert.throws(() => generator.happyHour(rec(clock, { promotions: [ended] }), PROMO.id, { now: clock.now() }), { code: 'promotion_ended' });
});

test('tournament: announce from owner input; names only with consent (S-4.5)', () => {
  const clock = makeClock();
  const input = { mode: 'announce', title: '88 Snooker Cup ครั้งที่ 1', eventDate: '2026-12-12', startTime: '13:00', detail: 'รับสมัคร 32 คน', feeTHB: 300, prizeText: 'ถ้วยรางวัล' };
  const draft = generator.tournament(input, { now: clock.now() });
  assert.match(draft.caption, /เสาร์ 12 ธ\.ค\. 2569 · 13:00 น\./);
  assert.match(draft.caption, /ค่าสมัคร 300 บาท/);
  assert.deepEqual(checks.checkDraft(draft), []);
  templates.validate('tournament', draft.templateData);
  assert.equal(draft.expiresAt, '2026-12-12T16:59:59.999Z');

  const result = { mode: 'result', title: '88 Snooker Cup ครั้งที่ 1', eventDate: '2026-11-21', winners: [{ place: 1, name: 'คุณเอ' }] };
  assert.throws(() => generator.tournament(result, { now: clock.now() }), { code: 'names_need_consent' });
  const ok = generator.tournament({ ...result, namesConsent: true }, { now: clock.now() });
  assert.match(ok.caption, /อันดับ 1 คุณเอ/);
  templates.validate('tournament', ok.templateData);
  assert.throws(() => generator.tournament({ ...input, eventDate: '2026-11-01' }, { now: clock.now() }), { code: 'event_in_past' });
  assert.throws(() => generator.tournament({ ...input, extra: 1 }, { now: clock.now() }), { code: 'bad_tournament' });
});

// ---------- checks ----------

test('S-4.2: a wrong price, a wrong table count or a made-up number is caught', () => {
  const clock = makeClock();
  const draft = generator.dailyTables(rec(clock), { now: clock.now() });
  const wrongPrice = { ...draft, caption: draft.caption.replace('เริ่ม 90 บาท', 'เริ่ม 70 บาท') };
  assert.deepEqual(checks.checkNumbers(wrongPrice), [{ where: 'caption', number: '70' }]);
  assert.equal(checks.checkDraft(wrongPrice)[0].code, 'wrong_numbers');

  const wrongImage = { ...draft, templateData: { ...draft.templateData, priceText: 'เริ่ม 100 บาท/ชม.' } };
  assert.deepEqual(checks.checkNumbers(wrongImage), [{ where: 'image', number: '100' }]);

  const wrongCount = { ...draft, templateData: { ...draft.templateData, available: 2 } };
  assert.ok(checks.checkDraft(wrongCount).some((i) => i.code === 'wrong_numbers' && i.where === 'image'));

  const promo = generator.happyHour(rec(clock), PROMO.id, { now: clock.now() });
  const wrongPromo = { ...promo, caption: promo.caption.replace('ชั่วโมงละ 80 บาท', 'ชั่วโมงละ 60 บาท') };
  assert.deepEqual(checks.checkNumbers(wrongPromo), [{ where: 'caption', number: '60' }]);
  // Thousands separators and the shop name are fine.
  assert.deepEqual(checks.numbersIn('1,200 บาท 120.00'), ['1200', '120']);
  assert.deepEqual(checks.checkNumbers({ ...draft, caption: '88 Snooker Club' }), []);
});

test('brand voice: forbidden words, emoji count and set, hashtags (§4.3)', () => {
  const v = (caption, hashtags = ['#88SnookerClub']) => checks.checkVoice({ caption, hashtags }).map((i) => i.code);
  assert.deepEqual(v('มาเล่นกันครับ 🎱✨'), []);
  assert.deepEqual(v('เล่นพนันได้'), ['forbidden_word']);
  assert.deepEqual(v('การันตีชนะ'), ['forbidden_word']);
  assert.deepEqual(v('🎱🎱✨🏆'), ['too_many_emoji']);
  assert.deepEqual(v('สนุกมาก 😂'), ['emoji_not_allowed']);
  assert.deepEqual(v('ok', ['#a b']), ['bad_hashtag']);
  assert.deepEqual(v('ok', ['#1', '#2', '#3', '#4', '#5', '#6', '#7']), ['too_many_hashtags']);
  assert.deepEqual(v('  '), ['caption_empty']);
  assert.deepEqual(checks.parseHashtags('#a b, #a  c'), ['#a', '#b', '#c']);
});

test('state machine (§3): only the allowed moves', () => {
  assert.ok(canTransition('pending_approval', 'approved'));
  assert.ok(canTransition('pending_approval', 'rejected'));
  assert.ok(canTransition('pending_approval', 'expired'));
  assert.ok(canTransition('approved', 'published'));
  assert.ok(!canTransition('rejected', 'approved'));
  assert.ok(!canTransition('expired', 'approved'));
  assert.ok(!canTransition('pending_approval', 'published'), 'no posting without approval (S-4.1)');
  for (const to of Object.values(TRANSITIONS).flat()) assert.ok(TRANSITIONS[to], `unknown status ${to}`);
});

// ---------- approval queue (Admin web API) ----------

test('create → pending_approval at L1; edit; approve with a time', async (t) => {
  const { h, admin, calls } = await hubWithShop(t);
  const c = await admin('POST', '/content/items', { templateId: 'daily_tables' });
  assert.equal(c.status, 201, c.text);
  const item = c.json.item;
  assert.equal(item.status, 'pending_approval');
  assert.equal(item.autonomyLevel, 'L1');
  assert.equal(item.sourceSnapshot.seq, 1);

  const src = await admin('GET', '/content/sources');
  assert.equal(src.json.pendingCount, 1);
  assert.equal(src.json.shop.available, 3);

  const edited = await admin('PATCH', `/content/items/${item.id}`, { caption: item.caption.replace('ทักแชทเพจเพื่อจองโต๊ะ', 'ทักแชทได้เลยครับ'), hashtags: '#88SnookerClub #โต๊ะว่าง' });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.json.item.edited, true);
  assert.deepEqual(edited.json.item.hashtags, ['#88SnookerClub', '#โต๊ะว่าง']);

  const img = await admin('GET', `/content/items/${item.id}/image`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(calls.at(-1).data.available, 3);

  const tooSoon = await admin('POST', `/content/items/${item.id}/approve`, { scheduledAt: new Date(h.clock.now() + 5 * MIN).toISOString() });
  assert.equal(tooSoon.json.error, 'scheduled_too_soon');
  const afterExpiry = await admin('POST', `/content/items/${item.id}/approve`, { scheduledAt: new Date(h.clock.now() + 90 * MIN).toISOString() });
  assert.equal(afterExpiry.json.error, 'scheduled_after_expiry');
  const when = new Date(h.clock.now() + 20 * MIN).toISOString();
  const ok = await admin('POST', `/content/items/${item.id}/approve`, { scheduledAt: when });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.item.status, 'approved');
  assert.equal(ok.json.item.approvedBy, 'owner');
  assert.equal(ok.json.item.scheduledAt, when);

  // Approved = no more edits; and only one daily_tables post per day.
  assert.equal((await admin('PATCH', `/content/items/${item.id}`, { caption: 'x' })).json.error, 'not_pending');
  assert.equal((await admin('POST', '/content/items', { templateId: 'daily_tables' })).json.error, 'daily_tables_already_today');

  const audit = (await admin('GET', '/audit?limit=20')).json.entries.map((e) => e.action);
  for (const a of ['content.created', 'content.edited', 'content.approved']) assert.ok(audit.includes(a), a);
});

test('S-4.2 through the API: an edit with a wrong price is refused', async (t) => {
  const { admin } = await hubWithShop(t);
  const item = (await admin('POST', '/content/items', { templateId: 'daily_tables' })).json.item;
  const r = await admin('PATCH', `/content/items/${item.id}`, { caption: item.caption.replace('เริ่ม 90 บาท', 'เริ่ม 50 บาท') });
  assert.equal(r.status, 422);
  assert.equal(r.json.error, 'checks_failed');
  assert.deepEqual(r.json.detail, [{ code: 'wrong_numbers', where: 'caption', number: '50' }]);
  const banned = await admin('PATCH', `/content/items/${item.id}`, { caption: 'มาเดิมพันกัน' });
  assert.equal(banned.json.detail[0].code, 'forbidden_word');
  // Nothing was saved.
  assert.equal((await admin('GET', `/content/items/${item.id}`)).json.item.caption, item.caption);
});

test('S-4.1: no way to raise a draft above L1', async (t) => {
  const { h, admin } = await hubWithShop(t);
  const item = (await admin('POST', '/content/items', { templateId: 'daily_tables' })).json.item;
  const r = await admin('PATCH', `/content/items/${item.id}`, { autonomyLevel: 'L2' });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'unknown_field');
  await assert.rejects(h.db.query("UPDATE content_items SET autonomy_level = 'L2' WHERE id = $1", [item.id]));
  assert.equal((await admin('GET', `/content/items/${item.id}`)).json.item.autonomyLevel, 'L1');
});

test('S-4.4: past expiresAt a draft expires and cannot be approved', async (t) => {
  const { h, admin } = await hubWithShop(t);
  const item = (await admin('POST', '/content/items', { templateId: 'daily_tables' })).json.item;
  h.clock.advance(61 * MIN);
  const r = await admin('POST', `/content/items/${item.id}/approve`, {});
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'not_pending');
  assert.equal(r.json.detail.status, 'expired');
  const list = await admin('GET', '/content/items?status=expired');
  assert.deepEqual(list.json.items.map((i) => i.id), [item.id]);
  assert.equal((await admin('GET', '/content/sources')).json.pendingCount, 0);
});

test('approve re-checks the live table count; "ร่างใหม่" uses the new data', async (t) => {
  const { d, h, admin } = await hubWithShop(t);
  const item = (await admin('POST', '/content/items', { templateId: 'daily_tables' })).json.item;
  const fewer = TABLES.map((x) => (x.tableNo === '1' ? { ...x, status: 'in_use', elapsedMin: 1 } : x));
  d.client.send('snapshot', shopSnapshot(h.clock, 2, { tables: fewer }));
  await d.client.flush();
  const review = await admin('GET', `/content/items/${item.id}`);
  assert.equal(review.json.dataChanged, true);
  assert.equal((await admin('POST', `/content/items/${item.id}/approve`, {})).json.error, 'shop_data_changed');

  const re = await admin('POST', `/content/items/${item.id}/regenerate`);
  assert.equal(re.status, 200, re.text);
  assert.equal(re.json.item.templateData.available, 2);
  assert.equal(re.json.item.variant, 1);
  assert.equal(re.json.item.sourceSnapshot.seq, 2);
  assert.equal((await admin('POST', `/content/items/${item.id}/approve`, {})).json.item.status, 'approved');
});

test('reject with a reason code; unknown reason refused', async (t) => {
  const { admin } = await hubWithShop(t);
  const item = (await admin('POST', '/content/items', { templateId: 'happy_hour', promotionId: PROMO.id })).json.item;
  assert.equal((await admin('POST', `/content/items/${item.id}/reject`, { reasonCode: 'boring' })).json.error, 'bad_reason');
  const r = await admin('POST', `/content/items/${item.id}/reject`, { reasonCode: 'off_brand', note: 'ขอสั้นกว่านี้' });
  assert.equal(r.json.item.status, 'rejected');
  assert.equal(r.json.item.rejectReason, 'off_brand');
  assert.equal(r.json.item.rejectNote, 'ขอสั้นกว่านี้');
  assert.equal((await admin('POST', `/content/items/${item.id}/approve`, {})).json.error, 'not_pending');
});

test('a background image with people but no consent cannot be picked (S-4.5)', async (t) => {
  const { admin, h } = await hubWithShop(t);
  const item = (await admin('POST', '/content/items', { templateId: 'happy_hour', promotionId: PROMO.id })).json.item;
  const png = PNG.sync.write(new PNG({ width: 300, height: 300 }));
  const up = async (consent) => (await fetch(`${h.base}/admin/api/assets?source=real&consent=${consent}`, {
    method: 'POST', headers: { 'x-hub-admin': '1', cookie: admin.cookie, 'content-type': 'application/octet-stream' }, body: png,
  }).then((r) => r.json())).asset;
  const locked = await up('missing');
  assert.equal((await admin('PATCH', `/content/items/${item.id}`, { assetId: locked.id })).json.error, 'consent_missing');
  const okAsset = await up('not_needed');
  const r = await admin('PATCH', `/content/items/${item.id}`, { assetId: okAsset.id });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.item.assetId, okAsset.id);
});

test('tournament through the API, and errors explain why nothing was made', async (t) => {
  const { admin } = await hubWithShop(t, { shop: { isOpenNow: false, todayHours: null } });
  assert.equal((await admin('POST', '/content/items', { templateId: 'daily_tables' })).json.error, 'shop_closed');
  assert.equal((await admin('POST', '/content/items', { templateId: 'nope' })).json.error, 'unknown_template');
  const r = await admin('POST', '/content/items', { templateId: 'tournament', tournament: { mode: 'announce', title: 'แข่งประจำเดือน', eventDate: '2026-12-05', feeTHB: 200 } });
  assert.equal(r.status, 201, r.text);
  assert.match(r.json.item.caption, /ค่าสมัคร 200 บาท/);
  assert.equal(r.json.item.sourceSnapshot.kind, 'owner_input');
});
