'use strict';

// A6 checks on a post draft, run when it is generated, every time the owner edits it and again
// when it is approved:
//   - numbers (S-4.2): every number in the caption, hashtags and image text must come from the
//     data the post was made from (`sourceSnapshot`). A wrong price or table count is caught.
//   - brand voice (CONTENT_PIPELINE §4.3): no forbidden words, at most 3 emoji from the brand
//     set, hashtags well-formed and few.
const brand = require('./brand');
const { thaiDate, splitDate } = require('./thai-date');
const { hhmm } = require('../agent/time');

const ALLOWED_EMOJI = Object.freeze(['🎱', '🏆', '✨', '🕗', '📍']);
const MAX_EMOJI = 3;
const MAX_HASHTAGS = 6;
const MAX_CAPTION = 1500;
/** Numbers that are part of the shop's name, always allowed. */
const BRAND_NUMBERS = Object.freeze(['88']);

/** Every number in a text, normalised: "1,200" → "1200", "120.00" → "120", "07" → "7". */
function numbersIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/\d+(?:[.,]\d+)*/g)) {
    out.push(normNumber(m[0]));
  }
  return out;
}

function normNumber(raw) {
  const s = String(raw);
  // "1,200" (thousands) vs "1.5" (decimal): commas are always thousands separators here.
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : s;
}

/** Numbers a post may use, from the data it was made from. */
function allowedNumbers(source) {
  const allowed = new Set(BRAND_NUMBERS);
  const addText = (t) => numbersIn(t).forEach((n) => allowed.add(n));
  const addDate = (iso) => {
    if (!iso) return;
    const { y, m, d } = splitDate(iso);
    [y, y + 543, m, d].forEach((n) => allowed.add(String(n)));
    addText(thaiDate(iso));
  };
  const data = (source && source.data) || {};

  if (source && source.kind === 'snapshot') {
    const snap = data;
    if (source.generatedAt) addText(hhmm(source.generatedAt));
    const avail = (snap.tables || []).filter((t) => t.status === 'available');
    allowed.add(String(avail.length));
    const perKind = {};
    for (const t of avail) perKind[t.kind] = (perKind[t.kind] || 0) + 1;
    Object.values(perKind).forEach((n) => allowed.add(String(n)));
    avail.forEach((t) => addText(t.tableNo));
    for (const p of snap.priceList || []) {
      allowed.add(normNumber(p.pricePerHourTHB));
      addText(p.label);
      addText(p.timeRange);
    }
    if (snap.shop && snap.shop.todayHours) {
      addText(snap.shop.todayHours.open);
      addText(snap.shop.todayHours.close);
    }
    for (const p of snap.promotions || []) {
      if (source.promotionId && p.id !== source.promotionId) continue;
      addText(p.title);
      addText(p.detail);
      addText(p.timeRange);
      addDate(p.validFrom);
      addDate(p.validTo);
    }
  } else if (source && source.kind === 'owner_input') {
    const t = data.tournament || {};
    addText(t.title);
    addText(t.detail);
    addText(t.prizeText);
    addText(t.startTime);
    if (t.feeTHB !== undefined && t.feeTHB !== null) allowed.add(normNumber(t.feeTHB));
    addDate(t.eventDate);
    for (const w of t.winners || []) {
      allowed.add(String(w.place));
      addText(w.name);
    }
  }
  return allowed;
}

/** Strings shown on the image (template data), for the number check. */
function imageStrings(templateData) {
  const out = [];
  (function collect(v) {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'number') out.push(String(v));
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  })(templateData || {});
  return out;
}

/**
 * S-4.2: numbers that do not come from the source data.
 * @returns {{ where: 'caption'|'hashtags'|'image', number: string }[]}
 */
function checkNumbers({ caption, hashtags, templateData, sourceSnapshot }) {
  const allowed = allowedNumbers(sourceSnapshot);
  const bad = [];
  const scan = (where, text) => {
    for (const n of numbersIn(text)) {
      if (!allowed.has(n) && !bad.some((b) => b.where === where && b.number === n)) bad.push({ where, number: n });
    }
  };
  scan('caption', caption);
  scan('hashtags', (hashtags || []).join(' '));
  // place numbers of winners ("อันดับ 1") and the variant flag are not data from outside
  scan('image', imageStrings(templateData).join(' '));
  return bad;
}

/** Extra structural checks per template: the headline number must be the real count. */
function checkTemplateFacts({ templateId, templateData, sourceSnapshot }) {
  const issues = [];
  if (templateId === 'daily_tables' && sourceSnapshot && sourceSnapshot.kind === 'snapshot') {
    const real = (sourceSnapshot.data.tables || []).filter((t) => t.status === 'available').length;
    if (!templateData || templateData.available !== real) issues.push({ code: 'wrong_numbers', where: 'image', number: String(templateData && templateData.available) });
  }
  return issues;
}

function emojisIn(text) {
  return [...String(text || '').matchAll(/\p{Extended_Pictographic}/gu)].map((m) => m[0]);
}

/**
 * Brand voice (§4.3).
 * @returns {{ code: string, word?: string, emoji?: string, count?: number, tag?: string }[]}
 */
function checkVoice({ caption, hashtags }) {
  const issues = [];
  const text = String(caption || '');
  if (!text.trim()) issues.push({ code: 'caption_empty' });
  if (text.length > MAX_CAPTION) issues.push({ code: 'caption_too_long', count: text.length });
  const word = brand.findForbidden(text) || brand.findForbidden((hashtags || []).join(' '));
  if (word) issues.push({ code: 'forbidden_word', word });
  const emojis = emojisIn(text + ' ' + (hashtags || []).join(' '));
  if (emojis.length > MAX_EMOJI) issues.push({ code: 'too_many_emoji', count: emojis.length });
  const other = emojis.find((e) => !ALLOWED_EMOJI.includes(e));
  if (other) issues.push({ code: 'emoji_not_allowed', emoji: other });
  const tags = hashtags || [];
  if (tags.length > MAX_HASHTAGS) issues.push({ code: 'too_many_hashtags', count: tags.length });
  for (const t of tags) {
    if (!/^#[\p{L}\p{M}\p{N}_]{1,40}$/u.test(t)) issues.push({ code: 'bad_hashtag', tag: String(t).slice(0, 50) });
  }
  return issues;
}

/** All checks. Empty list = the draft may be approved. */
function checkDraft(draft) {
  return [
    ...checkVoice(draft),
    ...checkNumbers(draft).map((b) => ({ code: 'wrong_numbers', ...b })),
    ...checkTemplateFacts(draft),
  ];
}

/** "#a #b, c" or ["#a", "b"] → ["#a", "#b", "#c"]. */
function parseHashtags(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[\s,]+/);
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const v = raw.trim();
    if (!v) continue;
    const tag = v.startsWith('#') ? v : '#' + v;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

module.exports = { checkDraft, checkVoice, checkNumbers, checkTemplateFacts, allowedNumbers, numbersIn, emojisIn, parseHashtags, ALLOWED_EMOJI, MAX_EMOJI, MAX_HASHTAGS, MAX_CAPTION };
