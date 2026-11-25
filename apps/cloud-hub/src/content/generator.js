'use strict';

// A6 generator (CONTENT_PIPELINE §1 "Generator"): writes the caption, hashtags and the
// ChatGPT image prompt for a post, plus the data for its image template.
//
// Free and offline: captions are filled-in sentences in the brand voice (§4.3), not an AI
// model. Every number comes from the shop data the post is made from, which is kept with the
// post as `sourceSnapshot` (S-4.2). `variant` picks another wording ("ร่างใหม่").
const { KIND_TH } = require('../agent/tools');
const { hhmm, localDate, localWeekday } = require('../agent/time');
const { thaiDate, thaiDateWithWeekday, daysText, endOfLocalDay } = require('./thai-date');

const MIN = 60 * 1000;
const DAILY_TABLES_TTL_MS = 60 * MIN; // §5 T1: expiresAt = created + 60 min (S-4.4)
const MIN_AVAILABLE = 2; // §5 T1: at least 2 free tables
const TONIGHT_FROM_HOUR = 17;
const BASE_TAGS = ['#88SnookerClub', '#สนุกเกอร์'];
const CTA = 'ทักแชทเพจเพื่อจองโต๊ะ';

class GeneratorError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/** §6 prompt template. The owner copies it into ChatGPT; no automation drives ChatGPT. */
function imagePrompt(scene, textArea = 'center') {
  return [
    `Premium snooker club promotional background, ${scene},`,
    'color palette deep navy blue (#0C1D55) and metallic gold (#D9AB54),',
    'elegant classic club atmosphere, soft vignette, warm pendant lighting,',
    `leave empty space at ${textArea} for text overlay,`,
    'NO text, NO letters, NO numbers, NO logos, NO people, NO faces, square 1:1',
  ].join('\n');
}

const SCENES = {
  daily_tables: ['empty snooker table under warm pendant lights, balls racked', 'close-up of red snooker balls on green baize', 'cue resting on the cushion of an empty snooker table'],
  happy_hour: ['cue tip chalk detail on dark wood', 'close-up of red snooker balls on green baize', 'snooker balls and a glass of iced drink on a dark wooden side table'],
  tournament: ['trophy on dark wooden table', 'gold trophy next to a snooker cue and balls', 'snooker table in a spotlight, dramatic atmosphere'],
};

const pick = (list, variant) => list[Math.abs(Number(variant) || 0) % list.length];

/** The latest snapshot record (snapshots.latest()) → the source kept with the post. */
function snapshotSource(rec, extra = {}) {
  return { kind: 'snapshot', seq: rec.seq, generatedAt: rec.asOf, ...extra, data: rec.snapshot };
}

function lowestPrice(snap, kind) {
  const prices = (snap.priceList || []).filter((p) => !kind || p.kind === kind).map((p) => p.pricePerHourTHB);
  return prices.length ? Math.min(...prices) : null;
}

/**
 * T1 daily_tables "โต๊ะว่างวันนี้".
 * @param {object|null} rec snapshots.latestActive() result
 * @param {{ now: number, variant?: number }} opts
 */
function dailyTables(rec, { now, variant = 0 }) {
  if (!rec || !rec.snapshot) throw new GeneratorError('no_shop_data');
  if (rec.stale) throw new GeneratorError('shop_data_stale');
  const snap = rec.snapshot;
  if (!snap.shop.isOpenNow) throw new GeneratorError('shop_closed');
  const avail = snap.tables.filter((t) => t.status === 'available');
  if (avail.length < MIN_AVAILABLE) throw new GeneratorError('not_enough_tables', { available: avail.length, min: MIN_AVAILABLE });

  const counts = {};
  for (const t of avail) counts[t.kind] = (counts[t.kind] || 0) + 1;
  const breakdown = ['snooker', 'pool'].filter((k) => counts[k]).map((k) => `${KIND_TH[k]} ${counts[k]} โต๊ะ`).join(' · ');
  const kinds = Object.keys(counts);
  const low = lowestPrice(snap, kinds.length === 1 ? kinds[0] : null);
  const priceText = low !== null ? `เริ่ม ${low} บาท/ชม.` : undefined;
  const asOf = hhmm(rec.asOf);
  const hour = Number(hhmm(now).slice(0, 2));
  const tonight = hour >= TONIGHT_FROM_HOUR || hour < 5;
  const n = avail.length;
  const headline = tonight ? `คืนนี้โต๊ะว่าง ${n} โต๊ะ` : `ว่างตอนนี้ ${n} โต๊ะ`;

  const openers = tonight
    ? [`${headline} 🎱`, `🎱 ${headline} มาวอร์มมือกันได้เลย`, `${headline} ✨ ใครว่างแวะมาได้เลยครับ`]
    : [`${headline} 🎱`, `🎱 ${headline} แวะมาซ้อมมือกันได้`, `${headline} ✨ ไม่ต้องรอคิว`];
  const lines = [pick(openers, variant), breakdown];
  if (priceText) lines.push(`ราคา${priceText}`);
  lines.push(`(ข้อมูล ณ ${asOf} น. โต๊ะอาจเปลี่ยนได้)`, '', CTA);

  return {
    templateId: 'daily_tables',
    summary: headline,
    templateData: { variant: tonight ? 'tonight' : 'now', available: n, breakdown, ...(priceText ? { priceText } : {}), asOfText: `ข้อมูล ณ ${asOf} น.` },
    caption: lines.join('\n'),
    hashtags: [...BASE_TAGS, '#โต๊ะว่าง'],
    imagePrompt: imagePrompt(pick(SCENES.daily_tables, variant)),
    sourceSnapshot: snapshotSource(rec),
    expiresAt: new Date(now + DAILY_TABLES_TTL_MS).toISOString(),
  };
}

/** T2 happy_hour "โปรช่วงเวลา": everything about the promotion comes from `promotions` (S-3.1). */
function happyHour(rec, promotionId, { now, variant = 0 }) {
  if (!rec || !rec.snapshot) throw new GeneratorError('no_shop_data');
  const p = (rec.snapshot.promotions || []).find((x) => x.id === promotionId);
  if (!p) throw new GeneratorError('promotion_not_found');
  const today = localDate(now);
  const validTo = p.validTo.slice(0, 10);
  if (validTo < today) throw new GeneratorError('promotion_ended');
  // Image text limits of the happy_hour template (templates.js).
  const MAX = { title: 40, detail: 90, timeText: 30 };
  if (p.title.trim().length > MAX.title) throw new GeneratorError('promotion_title_too_long', { max: MAX.title });

  const days = daysText(p.days);
  const timeText = p.timeRange ? `${days} ${p.timeRange} น.` : days;
  const fitsImage = (s, max) => (s && s.trim().length <= max ? s.trim() : undefined);
  const validText = `ถึง ${thaiDate(validTo)}`;
  const openers = [`✨ ${p.title}`, `🎱 โปรมาแล้ว: ${p.title}`, `${p.title} ✨`];
  const lines = [pick(openers, variant)];
  if (p.detail.trim()) lines.push(p.detail.trim());
  lines.push(`🕗 ${timeText}`, `โปรนี้${validText}`, '', CTA);

  return {
    templateId: 'happy_hour',
    summary: `โปร: ${p.title}`.slice(0, 200),
    templateData: {
      title: p.title.trim(),
      ...(fitsImage(p.detail, MAX.detail) ? { detail: p.detail.trim() } : {}),
      timeText: fitsImage(timeText, MAX.timeText) || days,
      validText,
    },
    caption: lines.join('\n'),
    hashtags: [...BASE_TAGS, '#โปรโมชั่น'],
    imagePrompt: imagePrompt(pick(SCENES.happy_hour, variant)),
    sourceSnapshot: snapshotSource(rec, { promotionId: p.id }),
    expiresAt: new Date(endOfLocalDay(validTo)).toISOString(),
  };
}

/**
 * T3 tournament "ประกาศ/ผลการแข่ง" from what the owner typed in the Admin web.
 * @param {{ mode: 'announce'|'result', title: string, eventDate: string, startTime?: string,
 *   detail?: string, feeTHB?: number, prizeText?: string,
 *   winners?: { place: number, name: string }[], namesConsent?: boolean }} input
 */
function tournament(input, { now, variant = 0 }) {
  const t = TournamentInput.safeParse(input);
  if (!t.success) throw new GeneratorError('bad_tournament', t.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })));
  const d = t.data;
  const today = localDate(now);
  if (d.mode === 'announce' && d.eventDate < today) throw new GeneratorError('event_in_past');
  if (d.winners && d.winners.length && !d.namesConsent) throw new GeneratorError('names_need_consent'); // S-4.5

  const dateText = thaiDateWithWeekday(d.eventDate) + (d.startTime ? ` · ${d.startTime} น.` : '');
  const feeText = d.feeTHB !== undefined ? `ค่าสมัคร ${d.feeTHB} บาท` : undefined;
  const winners = d.mode === 'result' && d.winners ? [...d.winners].sort((a, b) => a.place - b.place) : [];
  const lines = [];
  if (d.mode === 'announce') {
    lines.push(pick([`🏆 ประกาศการแข่งขัน ${d.title}`, `🏆 ${d.title} มาแล้ว`, `${d.title} 🏆`], variant), `📍 ${dateText}`);
    if (d.detail) lines.push(d.detail);
    if (feeText) lines.push(feeText);
    if (d.prizeText) lines.push(`รางวัล: ${d.prizeText}`);
    lines.push('', 'สนใจสมัคร ทักแชทเพจได้เลย');
  } else {
    lines.push(pick([`🏆 ผลการแข่งขัน ${d.title}`, `🏆 จบไปแล้วกับ ${d.title}`, `${d.title} 🏆 ผลการแข่งขัน`], variant), dateText);
    for (const w of winners) lines.push(`อันดับ ${w.place} ${w.name}`);
    if (d.detail) lines.push(d.detail);
    lines.push('', 'ขอบคุณนักกีฬาทุกท่านครับ');
  }
  // announce: until the end of the event day. result: one week after the event.
  const expires = d.mode === 'announce' ? endOfLocalDay(d.eventDate) : Math.max(endOfLocalDay(d.eventDate) + 7 * 24 * 60 * MIN, now + 24 * 60 * MIN);

  return {
    templateId: 'tournament',
    summary: `${d.mode === 'result' ? 'ผลการแข่ง' : 'ประกาศแข่ง'}: ${d.title}`.slice(0, 200),
    templateData: {
      mode: d.mode,
      title: d.title,
      dateText,
      ...(d.detail && d.detail.length <= 120 ? { detail: d.detail } : {}),
      ...(feeText ? { feeText } : {}),
      ...(d.prizeText && d.prizeText.length <= 40 ? { prizeText: d.prizeText } : {}),
      ...(winners.length ? { winners, namesConsent: true } : {}),
    },
    caption: lines.join('\n'),
    hashtags: [...BASE_TAGS, '#การแข่งขันสนุกเกอร์'],
    imagePrompt: imagePrompt(pick(SCENES.tournament, variant)),
    sourceSnapshot: { kind: 'owner_input', seq: null, generatedAt: new Date(now).toISOString(), data: { tournament: d } },
    expiresAt: new Date(expires).toISOString(),
  };
}

const { z } = require('zod');
const TournamentInput = z.object({
  mode: z.enum(['announce', 'result']),
  title: z.string().trim().min(1).max(50),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  detail: z.string().trim().max(300).optional(),
  feeTHB: z.number().int().min(0).max(100000).optional(),
  prizeText: z.string().trim().max(100).optional(),
  winners: z.array(z.object({ place: z.number().int().min(1).max(3), name: z.string().trim().min(1).max(30) }).strict()).max(3).optional(),
  namesConsent: z.boolean().optional(),
}).strict();

/**
 * One entry point for the admin web.
 * @param {{ templateId: string, promotionId?: string, tournament?: object }} request
 * @param {{ snapshot: object|null, now: number, variant?: number }} ctx
 */
function generate(request, { snapshot, now, variant = 0 }) {
  switch (request && request.templateId) {
    case 'daily_tables': return dailyTables(snapshot, { now, variant });
    case 'happy_hour': return happyHour(snapshot, String(request.promotionId || ''), { now, variant });
    case 'tournament': return tournament(request.tournament, { now, variant });
    default: throw new GeneratorError('unknown_template');
  }
}

/** Promotions the owner can make a post for now (not ended). */
function promotionsForPosts(rec, now) {
  if (!rec || !rec.snapshot) return [];
  const today = localDate(now);
  const wd = localWeekday(now);
  return (rec.snapshot.promotions || [])
    .filter((p) => p.validTo.slice(0, 10) >= today)
    .map((p) => ({ id: p.id, title: p.title, validTo: p.validTo.slice(0, 10), activeToday: p.validFrom.slice(0, 10) <= today && (!p.days || p.days.includes(wd)) }));
}

module.exports = { generate, dailyTables, happyHour, tournament, promotionsForPosts, imagePrompt, GeneratorError, DAILY_TABLES_TTL_MS, MIN_AVAILABLE };
