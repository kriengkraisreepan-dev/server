'use strict';

// A5 post templates (CONTENT_PIPELINE §5): HTML + CSS with the brand tokens, rendered to a
// 1080×1080 PNG by renderer.js. Text, prices and the logo are put on the image here, never by
// an image model (S-4.7). The data comes from the generator (A6); the template only checks
// its shape, length and the forbidden words, and escapes it.
const { z } = require('zod');
const brand = require('./brand');

const SIZE = Object.freeze({ width: 1080, height: 1080 });

const txt = (max) => z.string().trim().min(1).max(max);
const optTxt = (max) => z.string().trim().max(max).optional();

class TemplateError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Escape, then show every run of digits (prices, times, counts) in Zilla Slab gold (§4.2). */
function withNumbers(s) {
  return escapeHtml(s).replace(/\d+(?:[.,:]\d+)*/g, (m) => `<span class="num">${m}</span>`);
}

const TEMPLATES = {
  daily_tables: {
    id: 'daily_tables',
    label: 'โต๊ะว่างวันนี้',
    schema: z.object({
      variant: z.enum(['now', 'tonight']).default('now'),
      available: z.number().int().min(1).max(99),
      breakdown: optTxt(60),
      priceText: optTxt(40),
      asOfText: txt(40),
    }).strict(),
    sample: { variant: 'tonight', available: 4, breakdown: 'สนุกเกอร์ 3 โต๊ะ · พูล 1 โต๊ะ', priceText: 'เริ่ม 120 บาท/ชม.', asOfText: 'ข้อมูล ณ 19:30 น.' },
    content(d) {
      const headline = d.variant === 'now' ? `ว่างตอนนี้ ${d.available} โต๊ะ` : `คืนนี้โต๊ะว่าง ${d.available} โต๊ะ`;
      return {
        kicker: 'อัปเดตโต๊ะว่าง',
        headline,
        sub: d.breakdown || '',
        foot: d.priceText || '',
        note: d.asOfText,
      };
    },
  },
  happy_hour: {
    id: 'happy_hour',
    label: 'โปรช่วงเวลา',
    schema: z.object({
      title: txt(40),
      detail: optTxt(90),
      timeText: txt(30),
      priceText: optTxt(40),
      validText: optTxt(40),
    }).strict(),
    sample: { title: 'บ่ายสบาย ราคาพิเศษ', detail: 'ทุกวันจันทร์–ศุกร์ ทุกโต๊ะสนุกเกอร์', timeText: '13:00–17:00 น.', priceText: 'ชั่วโมงละ 80 บาท', validText: 'ถึง 31 ธ.ค. 2569' },
    content(d) {
      return {
        badge: 'โปร',
        kicker: d.timeText,
        headline: d.title,
        sub: d.detail || '',
        foot: d.priceText || '',
        note: d.validText || '',
      };
    },
  },
  tournament: {
    id: 'tournament',
    label: 'ประกาศ/ผลการแข่ง',
    schema: z.object({
      mode: z.enum(['announce', 'result']).default('announce'),
      title: txt(50),
      dateText: txt(40),
      detail: optTxt(120),
      feeText: optTxt(40),
      prizeText: optTxt(40),
      winners: z.array(z.object({ place: z.number().int().min(1).max(3), name: txt(30) }).strict()).max(3).optional(),
      // S-4.5: player names only with consent on file.
      namesConsent: z.boolean().default(false),
    }).strict(),
    sample: { mode: 'announce', title: '88 Snooker Cup ครั้งที่ 1', dateText: 'เสาร์ 12 ธ.ค. 2569 · 13:00 น.', detail: 'รับสมัคร 32 คน แข่งแบบแพ้คัดออก', feeText: 'ค่าสมัคร 300 บาท', prizeText: 'ถ้วยรางวัล + ของที่ระลึก' },
    check(d) {
      if (d.winners && d.winners.length) {
        if (d.mode !== 'result') throw new TemplateError('winners_only_in_result');
        if (!d.namesConsent) throw new TemplateError('names_need_consent');
      }
    },
    content(d) {
      const winners = d.mode === 'result' && d.winners && d.winners.length
        ? [...d.winners].sort((a, b) => a.place - b.place).map((w) => `อันดับ ${w.place} ${w.name}`).join(' · ')
        : '';
      return {
        kicker: d.mode === 'result' ? 'ผลการแข่งขัน' : 'ประกาศการแข่งขัน',
        headline: d.title,
        sub: winners || d.detail || '',
        extra: d.mode === 'announce' ? [d.feeText, d.prizeText].filter(Boolean).join(' · ') : '',
        foot: d.dateText,
        note: '',
      };
    },
  },
};

const TEMPLATE_IDS = Object.freeze(Object.keys(TEMPLATES));

/**
 * Validate template data. Throws TemplateError('bad_data' | 'forbidden_word' | …).
 * @returns {object} the parsed data (defaults applied, strings trimmed)
 */
function validate(templateId, data) {
  const t = Object.hasOwn(TEMPLATES, String(templateId)) ? TEMPLATES[templateId] : null;
  if (!t) throw new TemplateError('unknown_template');
  const r = t.schema.safeParse(data);
  if (!r.success) {
    throw new TemplateError('bad_data', r.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })));
  }
  const strings = [];
  (function collect(v) {
    if (typeof v === 'string') strings.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  })(r.data);
  for (const s of strings) {
    const w = brand.findForbidden(s);
    if (w) throw new TemplateError('forbidden_word', { word: w });
  }
  if (t.check) t.check(r.data);
  return r.data;
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1080px;overflow:hidden;background:var(--navy-deep)}
body{font-family:'Sarabun';color:var(--white);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.post{position:relative;width:1080px;height:1080px;display:flex;flex-direction:column}
.top{height:150px;background:var(--navy-deep);border-bottom:4px solid var(--gold-dark);display:flex;align-items:center;gap:24px;padding:0 48px}
.top img{height:118px;width:auto}
.brand{font-family:'Zilla Slab';font-weight:700;font-size:54px;letter-spacing:5px;color:var(--gold);line-height:1}
.mid{position:relative;flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;
  background:radial-gradient(ellipse at center,var(--navy) 0%,var(--navy) 55%,var(--navy-deep) 100%)}
.mid .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.mid .overlay{position:absolute;inset:0;background:rgba(12,29,85,.55)}
.mid .frame{position:absolute;inset:32px;border:3px solid var(--gold-dark);border-radius:6px;box-shadow:inset 0 0 0 1px var(--gold-light)}
.content{position:relative;width:860px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:26px}
.badge{font-family:'Kanit';font-weight:700;font-size:40px;line-height:1.25;background:var(--accent-red);color:var(--white);padding:6px 30px 10px;border-radius:999px}
.kicker{font-family:'Sarabun';font-weight:500;font-size:44px;line-height:1.5;color:var(--white)}
.headline{font-family:'Kanit';font-weight:700;font-size:112px;line-height:1.45;color:var(--gold);
  text-shadow:0 3px 0 var(--gold-dark),0 8px 24px rgba(12,12,26,.6);word-break:normal;overflow-wrap:anywhere}
.sub{font-family:'Sarabun';font-weight:400;font-size:46px;line-height:1.6;color:var(--white)}
.extra{font-family:'Sarabun';font-weight:500;font-size:40px;line-height:1.6;color:var(--gold-light)}
.num{font-family:'Zilla Slab';font-weight:700;color:var(--gold);font-variant-numeric:lining-nums tabular-nums}
.headline .num{font-size:1.08em}
.bottom{height:160px;background:var(--navy-deep);border-top:4px solid var(--gold-dark);display:flex;align-items:center;justify-content:space-between;gap:24px;padding:0 48px}
.foot{display:flex;flex-direction:column;justify-content:center;min-width:0}
.foot .main{font-family:'Sarabun';font-weight:500;font-size:44px;line-height:1.45;color:var(--white);white-space:nowrap}
.foot .note{font-family:'Sarabun';font-weight:400;font-size:30px;line-height:1.45;color:var(--gold-light);white-space:nowrap}
.cta{flex:none;font-family:'Kanit';font-weight:600;font-size:40px;line-height:1.3;color:var(--navy-deep);background:var(--gold);
  border:3px solid var(--gold-light);border-radius:999px;padding:10px 34px 14px}
`;

// Shrinks text that would not fit (long titles), so nothing is cut off. The renderer calls
// window.__fit() inside the page after the fonts have loaded (sizes depend on the font).
const FIT_SCRIPT = `
window.__fit = function(){
  function fit(el, maxH){
    var size = parseFloat(getComputedStyle(el).fontSize);
    while ((el.scrollHeight > maxH || el.scrollWidth > el.clientWidth + 1) && size > 24) { size -= 2; el.style.fontSize = size + 'px'; }
  }
  document.querySelectorAll('[data-fit]').forEach(function(el){ fit(el, Number(el.getAttribute('data-fit'))); });
  var mid = document.querySelector('.content');
  var box = document.querySelector('.mid');
  var guard = 0;
  while (mid.scrollHeight > box.clientHeight - 120 && guard++ < 40) {
    document.querySelectorAll('.headline,.sub,.kicker,.extra').forEach(function(el){
      el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) * 0.95) + 'px';
    });
  }
  document.querySelectorAll('.foot .main,.foot .note').forEach(function(el){
    var size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.parentElement.clientWidth + 1 && size > 18) { size -= 1; el.style.fontSize = size + 'px'; }
  });
};
`;

/**
 * Build the full HTML page for a template. Everything is inline (fonts, logo, background).
 * @param {string} templateId
 * @param {object} data already validated by validate()
 * @param {{ background?: { mime: string, data: Buffer } }} [options]
 */
function buildHtml(templateId, data, { background } = {}) {
  const t = Object.hasOwn(TEMPLATES, String(templateId)) ? TEMPLATES[templateId] : null;
  if (!t) throw new TemplateError('unknown_template');
  const c = t.content(data);
  const bg = background
    ? `<img class="bg" alt="" src="data:${background.mime};base64,${background.data.toString('base64')}"><div class="overlay"></div>`
    : '';
  const block = (cls, text, fit) => (text ? `<div class="${cls}"${fit ? ` data-fit="${fit}"` : ''}>${withNumbers(text)}</div>` : '');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8">
<style>${brand.fontFaceCss()}</style>
<style>${brand.colorVarsCss()}${CSS}</style></head>
<body><div class="post" data-template="${escapeHtml(t.id)}">
<div class="top"><img alt="" src="${brand.logoDataUrl()}"><div class="brand">88 SNOOKER CLUB</div></div>
<div class="mid">${bg}<div class="frame"></div><div class="content">
${c.badge ? `<div class="badge">${escapeHtml(c.badge)}</div>` : ''}
${block('kicker', c.kicker)}
${block('headline', c.headline, 340)}
${block('sub', c.sub, 230)}
${block('extra', c.extra, 140)}
</div></div>
<div class="bottom"><div class="foot">${c.foot ? `<div class="main">${withNumbers(c.foot)}</div>` : ''}${c.note ? `<div class="note">${withNumbers(c.note)}</div>` : ''}</div>
<div class="cta">จองทางแชท ►</div></div>
</div><script>${FIT_SCRIPT}</script></body></html>`;
}

function describe() {
  return TEMPLATE_IDS.map((id) => ({ id, label: TEMPLATES[id].label, size: SIZE, sample: TEMPLATES[id].sample }));
}

module.exports = { TEMPLATES, TEMPLATE_IDS, SIZE, validate, buildHtml, describe, escapeHtml, TemplateError, CSS };
