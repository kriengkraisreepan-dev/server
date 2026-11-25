'use strict';

// The 7 agent tools of Phase A (PHASE_A_TASKS A4). All read-only except handoff_to_staff,
// which only flags the conversation. Data comes from the snapshot cache and the Admin web,
// never from a live call into the Shop PC (ARCHITECTURE §5.1).
const { hhmm, localDate, localWeekday } = require('./time');

const KIND_TH = { snooker: 'สนุกเกอร์', pool: 'พูล' };
const AVG_SESSION_MIN = 90; // used only for the wait *estimate*

/** Tool definitions for the Claude API (JSON Schema, strict). */
const TOOL_DEFINITIONS = [
  {
    name: 'get_table_status',
    description: 'Current table availability at 88 Snooker Club, by table kind (snooker / pool), from the shop PC. Returns counts, available table numbers, whether the shop is open now, the data time (asOfLocal) and stale=true if the data is old. Use for any question about free tables.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_wait_estimate',
    description: 'Rough wait-time estimate when no table of a kind is free, from the queue length and how long current tables have been playing. Always present the result as an estimate.',
    input_schema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['snooker', 'pool', 'any'] } },
      required: ['kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_price_list',
    description: 'Table prices per hour in THB, by kind and time range, from the shop PC.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_shop_info',
    description: 'Opening hours today, whether the shop is open now, staff note, address, directions/parking and how to contact staff, plus the current local time.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_promotions',
    description: 'Promotions that are active today. If the list is empty there is no promotion; never invent one.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'search_faq',
    description: "Search the shop's FAQ written by the owner (rules, food & drinks, equipment, parking, membership, etc.).",
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Short search words, e.g. "ที่จอดรถ" or "bring own cue"' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'handoff_to_staff',
    description: 'Hand this conversation to a human staff member. After this the assistant stops replying in this conversation until staff release it. Use for bookings, complaints, money/refunds, lost items, accidents, threats, a request to talk to a person, or when you are not sure.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', enum: ['booking', 'complaint', 'money', 'lost_item', 'accident', 'threat', 'asked_for_human', 'unsure', 'no_shop_data', 'other'] },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
];
for (const t of TOOL_DEFINITIONS) t.strict = true;

function noData() {
  return { available: false, reason: 'no_data_from_shop', message: 'No data from the shop PC. Do not guess; offer staff.' };
}

/**
 * @param {{ snapshots: { latestActive(): Promise<object|null> }, knowledge: object, clock: { now(): number } }} deps
 * @returns {(name: string, input: object, ctx: { onHandoff(reason: string): Promise<void> }) => Promise<object>}
 */
function createToolRunner({ snapshots, knowledge, clock }) {
  async function snap() {
    const s = await snapshots.latestActive();
    return s && s.snapshot ? s : null;
  }

  function meta(s) {
    return { asOfLocal: hhmm(s.asOf), stale: s.stale };
  }

  const impl = {
    async get_table_status() {
      const s = await snap();
      if (!s) return noData();
      const byKind = {};
      for (const t of s.snapshot.tables) {
        const k = (byKind[t.kind] ||= { kind: t.kind, kindTh: KIND_TH[t.kind], total: 0, available: 0, in_use: 0, reserved: 0, maintenance: 0, availableTables: [] });
        k.total += 1;
        k[t.status] += 1;
        if (t.status === 'available') k.availableTables.push(t.tableNo);
      }
      return {
        available: true,
        ...meta(s),
        shopOpenNow: s.snapshot.shop.isOpenNow,
        queueWaiting: s.snapshot.queue.waiting,
        kinds: Object.values(byKind),
      };
    },

    async get_wait_estimate({ kind = 'any' } = {}) {
      const s = await snap();
      if (!s) return noData();
      const tables = s.snapshot.tables.filter((t) => kind === 'any' || t.kind === kind);
      if (tables.some((t) => t.status === 'available')) return { available: true, ...meta(s), isEstimate: true, freeNow: true, waitMinutes: 0 };
      const remaining = tables
        .filter((t) => t.status === 'in_use')
        .map((t) => Math.max(10, AVG_SESSION_MIN - (t.elapsedMin || 0)))
        .sort((a, b) => a - b);
      if (!remaining.length) return { available: true, ...meta(s), isEstimate: true, freeNow: false, cannotEstimate: true };
      const ahead = s.snapshot.queue.waiting;
      const base = remaining[Math.min(ahead, remaining.length - 1)];
      const round10 = (n) => Math.max(10, Math.round(n / 10) * 10);
      return {
        available: true,
        ...meta(s),
        isEstimate: true,
        freeNow: false,
        queueWaiting: ahead,
        waitMinutesFrom: round10(base - 10),
        waitMinutesTo: round10(base + 20),
        note: 'Rough estimate only. Players can stop early or extend.',
      };
    },

    async get_price_list() {
      const s = await snap();
      if (!s) return noData();
      return {
        available: true,
        ...meta(s),
        prices: s.snapshot.priceList.map((p) => ({ kind: p.kind, kindTh: KIND_TH[p.kind], label: p.label, pricePerHourTHB: p.pricePerHourTHB, ...(p.timeRange ? { timeRange: p.timeRange } : {}) })),
      };
    },

    async get_shop_info() {
      const s = await snap();
      const info = await knowledge.getShopInfo();
      return {
        nowLocal: hhmm(clock.now()),
        todayLocal: localDate(clock.now()),
        fromShopPc: s
          ? { ...meta(s), isOpenNow: s.snapshot.shop.isOpenNow, todayHours: s.snapshot.shop.todayHours, ...(s.snapshot.shop.note ? { staffNote: s.snapshot.shop.note } : {}) }
          : null,
        fromOwner: info,
      };
    },

    async get_promotions() {
      const s = await snap();
      if (!s) return noData();
      const today = localDate(clock.now());
      const wd = localWeekday(clock.now());
      const active = s.snapshot.promotions.filter((p) =>
        p.validFrom.slice(0, 10) <= today && today <= p.validTo.slice(0, 10) && (!p.days || p.days.includes(wd)));
      return {
        available: true,
        ...meta(s),
        promotions: active.map((p) => ({ title: p.title, detail: p.detail, validTo: p.validTo.slice(0, 10), ...(p.timeRange ? { timeRange: p.timeRange } : {}) })),
      };
    },

    async search_faq({ query = '' } = {}) {
      const results = await knowledge.searchFaq(String(query).slice(0, 200));
      return { results };
    },

    async handoff_to_staff({ reason = 'other' } = {}, ctx) {
      await ctx.onHandoff(String(reason));
      return { ok: true, message: 'Staff have been notified. Tell the customer a staff member will reply soon. Do not promise anything else.' };
    },
  };

  return async function runTool(name, input, ctx) {
    const fn = impl[name];
    if (!fn) return { error: 'unknown_tool' };
    return fn(input && typeof input === 'object' ? input : {}, ctx);
  };
}

module.exports = { TOOL_DEFINITIONS, createToolRunner, KIND_TH };
