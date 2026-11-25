'use strict';

// A5 acceptance: asset library + renderer (PHASE_A_TASKS A5, CONTENT_PIPELINE §3–5, S-4.5, S-4.7).
//
// Render tests need Chromium. They run when `playwright-core` can start one (CHROMIUM_PATH, or
// PLAYWRIGHT_BROWSERS_PATH after `npx playwright-core install chromium-headless-shell`) and are
// skipped otherwise — set REQUIRE_RENDERER=1 to make a missing browser a failure.
// Thai snapshot baselines: test/snapshots/*.png. Re-create with UPDATE_SNAPSHOTS=1 after a
// deliberate design change, and look at every new image before committing it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const { startHub } = require('./helpers');
const { sniffImage, assertUsable, AssetError } = require('../src/content/assets');
const templates = require('../src/content/templates');
const brand = require('../src/content/brand');
const { createRenderer } = require('../src/content/renderer');

const SNAP_DIR = path.join(__dirname, 'snapshots');

function makePng(width = 300, height = 300, rgb = [20, 120, 60]) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgb[0]; png.data[i * 4 + 1] = rgb[1]; png.data[i * 4 + 2] = rgb[2]; png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

/** Smallest JPEG header the sniffer needs: SOI, APP0, SOF0 (height 400, width 600). */
function fakeJpeg() {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0', 'latin1'), Buffer.alloc(9),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x90, 0x02, 0x58, 0x03]), Buffer.alloc(9), Buffer.from([0xff, 0xd9]),
  ]);
}

function pixel(png, x, y) {
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const near = (a, b, tol = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

/** Share of pixels that differ by more than `tol` in any channel. */
function diffRatio(a, b, tol = 40) {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let bad = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > tol || Math.abs(a.data[i + 1] - b.data[i + 1]) > tol || Math.abs(a.data[i + 2] - b.data[i + 2]) > tol) bad++;
  }
  return bad / (a.width * a.height);
}

function matchSnapshot(name, pngBuf, maxRatio = 0.01) {
  const file = path.join(SNAP_DIR, name);
  if (process.env.UPDATE_SNAPSHOTS === '1' || !fs.existsSync(file)) {
    if (process.env.UPDATE_SNAPSHOTS !== '1') assert.fail(`missing snapshot ${name}: run with UPDATE_SNAPSHOTS=1 and review the image`);
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    fs.writeFileSync(file, pngBuf);
    return;
  }
  const ratio = diffRatio(PNG.sync.read(fs.readFileSync(file)), PNG.sync.read(pngBuf));
  if (ratio > maxRatio) {
    const out = path.join(SNAP_DIR, name.replace(/\.png$/, '.actual.png'));
    fs.writeFileSync(out, pngBuf);
    assert.fail(`${name} differs from the baseline in ${(ratio * 100).toFixed(2)}% of pixels (actual image: ${path.relative(process.cwd(), out)})`);
  }
}

// ---------- pure functions (no browser, no database) ----------

test('sniffImage reads type and size from the bytes', () => {
  assert.deepEqual(sniffImage(makePng(320, 240)), { mime: 'image/png', width: 320, height: 240 });
  assert.deepEqual(sniffImage(fakeJpeg()), { mime: 'image/jpeg', width: 600, height: 400 });
  // VP8X WebP header, 1080×1080.
  const webp = Buffer.alloc(40);
  webp.write('RIFF', 0, 'latin1'); webp.write('WEBP', 8, 'latin1'); webp.write('VP8X', 12, 'latin1');
  webp.writeUIntLE(1079, 24, 3); webp.writeUIntLE(1079, 27, 3);
  assert.deepEqual(sniffImage(webp), { mime: 'image/webp', width: 1080, height: 1080 });
  // Not images: SVG (can carry script), HTML, GIF, empty.
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(sniffImage(Buffer.from('<!doctype html><html><body>hi</body></html>')), null);
  assert.equal(sniffImage(Buffer.from('GIF89a' + '\0'.repeat(40), 'latin1')), null);
  assert.equal(sniffImage(Buffer.alloc(0)), null);
});

test('S-4.5: an asset without consent can never be used in a template', () => {
  const base = { kind: 'image', source: 'real', consent: 'recorded', allowedTemplates: null };
  assert.doesNotThrow(() => assertUsable(base, 'daily_tables'));
  assert.doesNotThrow(() => assertUsable({ ...base, consent: 'not_needed' }, 'happy_hour'));
  for (const id of templates.TEMPLATE_IDS) {
    assert.throws(() => assertUsable({ ...base, consent: 'missing' }, id), (e) => e instanceof AssetError && e.code === 'consent_missing');
  }
  assert.throws(() => assertUsable({ ...base, consent: 'whatever' }, 'happy_hour'), (e) => e.code === 'asset_invalid');
  assert.throws(() => assertUsable({ ...base, allowedTemplates: ['tournament'] }, 'happy_hour'), (e) => e.code === 'asset_not_allowed_for_template');
  assert.doesNotThrow(() => assertUsable({ ...base, allowedTemplates: ['tournament'] }, 'tournament'));
});

test('template data is validated, escaped and checked for forbidden words', () => {
  for (const id of templates.TEMPLATE_IDS) assert.ok(templates.validate(id, templates.TEMPLATES[id].sample));
  assert.throws(() => templates.validate('nope', {}), (e) => e.code === 'unknown_template');
  assert.throws(() => templates.validate('__proto__', {}), (e) => e.code === 'unknown_template');
  assert.throws(() => templates.validate('daily_tables', { available: 0, asOfText: 'x' }), (e) => e.code === 'bad_data');
  assert.throws(() => templates.validate('daily_tables', { available: 3, asOfText: 'x', extra: 1 }), (e) => e.code === 'bad_data');
  assert.throws(() => templates.validate('happy_hour', { title: 'ก'.repeat(41), timeText: '13:00' }), (e) => e.code === 'bad_data');
  // §4.3 forbidden words / gambling (S-4.5).
  assert.throws(() => templates.validate('tournament', { title: 'แข่งพนันขันต่อ', dateText: 'เสาร์' }), (e) => e.code === 'forbidden_word');
  assert.throws(() => templates.validate('happy_hour', { title: 'ถูกที่สุดในระยอง', timeText: '13:00' }), (e) => e.code === 'forbidden_word');
  assert.throws(() => templates.validate('tournament', { title: 'Cup', dateText: 'Sat', detail: 'place your bets' }), (e) => e.code === 'forbidden_word');
  assert.ok(templates.validate('tournament', { title: 'แทงสนุกชิงถ้วย', dateText: 'เสาร์', detail: 'between friends' }));
  // S-4.5: winner names only with consent.
  const result = { mode: 'result', title: 'ผลการแข่ง', dateText: 'เสาร์', winners: [{ place: 1, name: 'คุณเอ' }] };
  assert.throws(() => templates.validate('tournament', result), (e) => e.code === 'names_need_consent');
  assert.ok(templates.validate('tournament', { ...result, namesConsent: true }));
  // Text is escaped: no HTML from data reaches the page.
  const html = templates.buildHtml('happy_hour', templates.validate('happy_hour', { title: '<img src=x onerror=alert(1)>', timeText: '13:00' }));
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(/);
});

test('templates use only the brand colour tokens and the brand fonts (§4.1, §4.2)', () => {
  const allowed = new Set(Object.values(brand.COLORS).map((c) => c.toLowerCase()));
  const css = templates.CSS;
  for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) assert.ok(allowed.has(m[0].toLowerCase()), `colour ${m[0]} is not a brand token`);
  // rgba() only as the navy overlay (55 %, §5) or navy-deep shadow.
  for (const m of css.matchAll(/rgba\((\d+),(\d+),(\d+),/g)) {
    const h = '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
    assert.ok([brand.COLORS.navy, brand.COLORS['navy-deep']].includes(h), `rgba colour ${h} is not navy/navy-deep`);
  }
  assert.match(css, /\.mid \.overlay\{[^}]*rgba\(12,29,85,\.55\)/, 'background overlay = navy 55 %');
  const families = new Set([...css.matchAll(/font-family:'([^']+)'/g)].map((m) => m[1]));
  assert.deepEqual([...families].sort(), ['Kanit', 'Sarabun', 'Zilla Slab']);
  for (const f of brand.FONT_FACES) assert.ok(fs.existsSync(path.join(__dirname, '../src/content/fonts', f.file)), f.file);
  // Fonts ship inside the app, with their licence.
  for (const lic of ['OFL-Kanit.txt', 'OFL-Sarabun.txt', 'OFL-ZillaSlab.txt']) assert.ok(fs.existsSync(path.join(__dirname, '../src/content/fonts', lic)));
});

test('page HTML is self-contained: no http(s) URL anywhere (offline render)', () => {
  for (const id of templates.TEMPLATE_IDS) {
    const html = templates.buildHtml(id, templates.validate(id, templates.TEMPLATES[id].sample), { background: { mime: 'image/png', data: makePng() } });
    assert.doesNotMatch(html, /https?:\/\//i, id);
    assert.doesNotMatch(html, /<link\b/i, id);
  }
});

// ---------- asset library through the Admin web API ----------

test('asset library (Admin web API)', async (t) => {
  let h;
  let admin;
  // A stub renderer: the API tests check the consent gate, not Chromium.
  const calls = [];
  const renderer = {
    async render(templateId, data, opts) {
      templates.validate(templateId, data);
      calls.push({ templateId, background: opts.background ? opts.background.mime : null });
      return { png: makePng(1080, 1080) };
    },
  };
  t.beforeEach(async () => {
    h = await startHub({ deps: { renderer } });
    admin = await h.adminLogin();
    calls.length = 0;
  });
  t.afterEach(async () => { await h.close(); });

  const upload = (buf, q) =>
    fetch(h.base + '/admin/api/assets?' + new URLSearchParams(q), {
      method: 'POST', body: buf, headers: { 'x-hub-admin': '1', cookie: admin.cookie, 'content-type': 'application/octet-stream' },
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

  await t.test('needs login', async () => {
    for (const [m, p] of [['GET', '/assets'], ['POST', '/assets'], ['PATCH', '/assets/x'], ['DELETE', '/assets/x'], ['GET', '/assets/x/image'], ['POST', '/content/preview'], ['GET', '/content/templates']]) {
      const r = await h.http(m, '/admin/api' + p, { headers: { 'x-hub-admin': '1' } });
      assert.equal(r.status, 401, `${m} ${p}`);
    }
  });

  await t.test('upload, list, image, update consent, delete — all audited', async () => {
    const png = makePng(400, 300);
    const up = await upload(png, { source: 'real', consent: 'not_needed', tags: 'โต๊ะ, Night ,โต๊ะ' });
    assert.equal(up.status, 201);
    const a = up.json.asset;
    assert.match(a.id, /^ast_/);
    assert.deepEqual([a.mime, a.width, a.height, a.bytes], ['image/png', 400, 300, png.length]);
    assert.deepEqual(a.tags, ['โต๊ะ', 'night']);
    assert.equal(a.usable, true);

    const list = await admin('GET', '/assets');
    assert.equal(list.json.assets.length, 1);
    assert.equal(list.json.assets[0].data, undefined, 'list never carries image bytes');
    assert.equal(list.json.usage.count, 1);

    const img = await fetch(`${h.base}/admin/api/assets/${a.id}/image`, { headers: { 'x-hub-admin': '1', cookie: admin.cookie } });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(Buffer.from(await img.arrayBuffer()).equals(png));

    const upd = await admin('PATCH', `/assets/${a.id}`, { consent: 'missing' });
    assert.equal(upd.json.asset.usable, false);
    assert.equal((await admin('PATCH', `/assets/${a.id}`, { consent: 'yes' })).status, 400);
    assert.equal((await admin('PATCH', `/assets/${a.id}`, { allowedTemplates: ['nope'] })).status, 400);

    assert.equal((await admin('DELETE', `/assets/${a.id}`)).status, 200);
    assert.equal((await admin('DELETE', `/assets/${a.id}`)).status, 404);
    const actions = (await h.hub.audit.recent(20)).map((e) => e.action);
    for (const x of ['asset.uploaded', 'asset.updated', 'asset.deleted']) assert.ok(actions.includes(x), x);
  });

  await t.test('rejects non-images, tiny/huge files, and missing source/consent', async () => {
    assert.equal((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(200)), { source: 'ai', consent: 'not_needed' })).status, 415);
    assert.equal((await upload(makePng(100, 100), { source: 'ai', consent: 'not_needed' })).json.error, 'image_too_small');
    const big = Buffer.concat([makePng(300, 300), Buffer.alloc(5 * 1024 * 1024)]);
    assert.equal((await upload(big, { source: 'ai', consent: 'not_needed' })).status, 413);
    assert.equal((await upload(makePng(), { consent: 'not_needed' })).json.error, 'bad_source');
    assert.equal((await upload(makePng(), { source: 'ai' })).json.error, 'bad_consent');
    assert.equal((await upload(makePng(), { source: 'ai', consent: 'maybe' })).json.error, 'bad_consent');
    assert.equal((await admin('GET', '/assets')).json.assets.length, 0);
  });

  await t.test('preview: consent "missing" is refused (409); after consent is recorded it renders', async () => {
    const a = (await upload(makePng(), { source: 'real', consent: 'missing' })).json.asset;
    assert.equal(a.usable, false);
    for (const id of templates.TEMPLATE_IDS) {
      const r = await admin('POST', '/content/preview', { templateId: id, assetId: a.id });
      assert.equal(r.status, 409, id);
      assert.equal(r.json.error, 'consent_missing');
    }
    assert.equal(calls.length, 0, 'the renderer is never reached');

    await admin('PATCH', `/assets/${a.id}`, { consent: 'recorded' });
    const ok = await fetch(h.base + '/admin/api/content/preview', {
      method: 'POST', headers: { 'x-hub-admin': '1', cookie: admin.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: 'daily_tables', assetId: a.id }),
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/png');
    assert.deepEqual(calls, [{ templateId: 'daily_tables', background: 'image/png' }]);
  });

  await t.test('preview: per-asset template list, unknown template/asset, bad data', async () => {
    const a = (await upload(makePng(), { source: 'ai', consent: 'not_needed', allowedTemplates: 'tournament' })).json.asset;
    assert.deepEqual(a.allowedTemplates, ['tournament']);
    assert.equal((await admin('POST', '/content/preview', { templateId: 'happy_hour', assetId: a.id })).json.error, 'asset_not_allowed_for_template');
    assert.equal((await admin('POST', '/content/preview', { templateId: 'nope' })).status, 400);
    assert.equal((await admin('POST', '/content/preview', { templateId: 'constructor' })).status, 400);
    assert.equal((await admin('POST', '/content/preview', { templateId: 'daily_tables', assetId: 'ast_missing' })).status, 404);
    const bad = await admin('POST', '/content/preview', { templateId: 'daily_tables', data: { available: 'many' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, 'bad_data');
  });

  await t.test('admin page has the คลังรูป and preview sections; CSP allows blob: images only', async () => {
    const r = await h.http('GET', '/admin/');
    assert.match(r.text, /คลังรูป/);
    assert.match(r.text, /ดูตัวอย่างภาพ/);
    assert.match(r.headers.get('content-security-policy'), /img-src 'self' blob:;/);
  });
});

// ---------- real rendering with Chromium ----------

let rendererProbe = null;
async function rendererOrSkip(t) {
  if (!rendererProbe) {
    const r = createRenderer({ executablePath: process.env.CHROMIUM_PATH || null });
    rendererProbe = r.renderHtml('<html><body>ok</body></html>', { width: 10, height: 10 }).then(() => r, (e) => e);
  }
  const r = await rendererProbe;
  if (r instanceof Error) {
    if (process.env.REQUIRE_RENDERER === '1') throw r;
    t.skip(`no Chromium for the renderer (${r.code || r.message}) — see the comment at the top of this file`);
    return null;
  }
  return r;
}

/** Thai text that breaks easily: stacked marks, tall vowels, descenders, tone marks on วรรณยุกต์ positions. */
const THAI_LINES = [
  'ปู่ป้าฝากน้ำปั่น ฟ้าผ่าป่าไผ่',
  'ญี่ปุ่น ฐานะ ฎีกา ฏักกา ฤๅษี',
  'กี่ปี่ปี๊ปั๋ม ที่นี่ผู้ใหญ่ ไม้เอก่ ไม้โท้',
  'โต๊ะว่าง ๘๘ สนุกเกอร์ ราคา 120 บาท',
  'กรุณาจองล่วงหน้า ค่ำนี้เปิดถึงตีสอง',
];

function thaiCardHtml() {
  const rows = [['Kanit', 700, 60], ['Kanit', 600, 52], ['Sarabun', 500, 44], ['Sarabun', 400, 40]];
  const body = rows.map(([fam, w, size]) =>
    THAI_LINES.slice(0, fam === 'Kanit' ? 3 : 5).map((l) => `<div style="font-family:'${fam}';font-weight:${w};font-size:${size}px;line-height:1.6">${templates.escapeHtml(l)}</div>`).join('')).join('<hr>');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>${brand.fontFaceCss()}</style>
<style>${brand.colorVarsCss()}html,body{margin:0;width:1080px;height:1400px;background:var(--navy);color:var(--white)}
body{padding:24px 40px;box-sizing:border-box}hr{border:0;border-top:2px solid var(--gold-dark);margin:10px 0}</style></head>
<body>${body}</body></html>`;
}

test('renderer (Chromium)', async (t) => {
  const r = await rendererOrSkip(t);
  if (!r) return;

  await t.test('each template → 1080×1080 PNG, all brand fonts loaded, no network', async () => {
    for (const id of templates.TEMPLATE_IDS) {
      const out = await r.render(id, templates.TEMPLATES[id].sample);
      const png = PNG.sync.read(out.png);
      assert.deepEqual([png.width, png.height], [1080, 1080], id);
      assert.equal(out.fonts.length, brand.FONT_FACES.length);
      assert.ok(out.fonts.every((f) => f.status === 'loaded'), id);
      assert.deepEqual(out.blockedRequests, [], `${id} made no network request`);
      // Brand colours where the layout puts them: top/bottom bars navy-deep, middle navy, gold CTA.
      assert.ok(near(pixel(png, 900, 20), hex(brand.COLORS['navy-deep'])), `${id} top bar`);
      assert.ok(near(pixel(png, 10, 1070), hex(brand.COLORS['navy-deep'])), `${id} bottom bar`);
      assert.ok(near(pixel(png, 70, 540), hex(brand.COLORS.navy), 10), `${id} middle navy`);
      assert.ok(near(pixel(png, 735, 1000), hex(brand.COLORS.gold)), `${id} gold CTA`);
      matchSnapshot(`${id}.png`, out.png);
    }
  });

  await t.test('Thai vowels and tone marks render correctly (snapshot)', async () => {
    const out = await r.renderHtml(thaiCardHtml(), { width: 1080, height: 1400 });
    assert.ok(out.fonts.every((f) => f.status === 'loaded'));
    matchSnapshot('thai-text.png', out.png, 0.005);
  });

  await t.test('a background image is drawn under a navy overlay', async () => {
    const out = await r.render('happy_hour', templates.TEMPLATES.happy_hour.sample, { background: { mime: 'image/png', data: makePng(600, 600, [200, 20, 30]) } });
    const p = pixel(PNG.sync.read(out.png), 70, 540);
    // red 55 % covered by navy (12,29,85): ≈ (97,24,60)
    assert.ok(near(p, [97, 24, 60], 8), `got ${p}`);
  });

  await t.test('works with no internet: external URLs in a page are blocked, not fetched', async () => {
    const html = `<!doctype html><html><head><style>${brand.fontFaceCss()}</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Kanit"></head>
<body style="font-family:Kanit"><img src="https://example.com/x.png">สวัสดี<script src="http://example.com/a.js"></script></body></html>`;
    const out = await r.renderHtml(html, { width: 200, height: 100 });
    assert.ok(out.png.length > 0);
    assert.equal(out.blockedRequests.length, 3);
    assert.ok(out.blockedRequests.every((u) => /^https?:\/\//.test(u)));
  });

  await t.test('bad data never reaches the browser', async () => {
    const before = r.stats().renders;
    await assert.rejects(r.render('daily_tables', { available: -1, asOfText: 'x' }), (e) => e.code === 'bad_data');
    assert.equal(r.stats().renders, before);
  });
});
