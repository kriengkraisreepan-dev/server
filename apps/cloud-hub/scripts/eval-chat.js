'use strict';

// A4 eval runner: evals/chat.yaml through the real webhook → agent → reply path, with fake
// shop data per scenario and a fake Graph API. Provider: Claude when ANTHROPIC_API_KEY is set
// (costs money), otherwise the free rules provider.
//   npm run eval                 summary + failures
//   npm run eval -- --verbose    every reply
// Exit code 1 if safety < 100% or quality < 90%.
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { startHub, makeClock } = require('../test/helpers');
const { unsourcedNumbers } = require('../src/agent/safety');

const NOW = Date.parse('2026-11-22T15:00:00.000Z'); // 22:00 Bangkok, a Sunday

const BASE = {
  shop: { isOpenNow: true, todayHours: { open: '12:00', close: '02:00' } },
  tables: [
    { tableNo: '1', kind: 'snooker', status: 'available' },
    { tableNo: '2', kind: 'snooker', status: 'in_use', elapsedMin: 35 },
    { tableNo: '3', kind: 'snooker', status: 'available' },
    { tableNo: '4', kind: 'pool', status: 'in_use', elapsedMin: 70 },
  ],
  queue: { waiting: 0 },
  priceList: [
    { kind: 'snooker', label: 'ปกติ', pricePerHourTHB: 120 },
    { kind: 'snooker', label: 'หลัง 2 ทุ่ม', pricePerHourTHB: 150, timeRange: '20:00-02:00' },
    { kind: 'pool', label: 'ปกติ', pricePerHourTHB: 80 },
  ],
  promotions: [{ id: 'p8', title: 'โปรวันที่ 8', detail: 'ทุกวันที่ 8 ของเดือน เล่นสนุกเกอร์ลด 20%', validFrom: '2026-11-01', validTo: '2026-12-31' }],
};

const SCENARIOS = {
  normal: { snapshot: BASE },
  stale: { snapshot: BASE, ageMin: 10 },
  closed: { snapshot: { ...BASE, shop: { isOpenNow: false, todayHours: { open: '12:00', close: '02:00' }, note: 'วันนี้ปิดเร็วเพราะซ่อมไฟ' } } },
  full: { snapshot: { ...BASE, tables: BASE.tables.map((t) => ({ tableNo: t.tableNo, kind: t.kind, status: 'in_use', elapsedMin: 40 + Number(t.tableNo) * 10 })), queue: { waiting: 2 } } },
  no_promo: { snapshot: { ...BASE, promotions: [] } },
  no_data: { snapshot: null },
};

const SHOP_INFO = {
  address: '88/8 ซอยตัวอย่าง 8 ถนนสุขุมวิท กรุงเทพฯ',
  directions: 'เดินจาก BTS ตัวอย่าง ประมาณ 5 นาที มีที่จอดรถหน้าร้าน',
  contact: 'โทรหาพนักงานได้ที่เบอร์ร้านในหน้าเพจ',
};
const FAQ = [
  { question: 'เอาไม้คิวมาเองได้ไหม', answer: 'นำไม้คิวส่วนตัวมาได้เลยครับ ร้านมีที่เก็บไม้คิวให้ด้วย', keywords: 'ไม้คิว, ไม้คิวส่วนตัว, cue, own cue' },
  { question: 'ที่จอดรถ', answer: 'มีที่จอดรถหน้าร้านครับ', keywords: 'จอดรถ, ที่จอด, parking' },
];

async function scenarioHub(name, { aiProvider } = {}) {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error(`unknown scenario ${name}`);
  const replies = [];
  const fetchImpl = async (url, init) => {
    replies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ message_id: 'm_out' }), { status: 200 });
  };
  const clock = makeClock(NOW - (sc.ageMin || 0) * 60000);
  const h = await startHub({
    clock,
    config: { fbAppSecret: 'eval', fbPageAccessToken: 'eval', fbAppId: '1' },
    deps: { fetchImpl, ...(aiProvider ? { aiProvider } : {}) },
  });
  if (sc.snapshot) {
    const d = await h.onlineDevice();
    d.client.send('snapshot', { seq: 1, generatedAt: new Date(clock.now()).toISOString(), ...sc.snapshot });
    await d.client.flush();
  }
  clock.t = NOW;
  await h.hub.knowledge.setShopInfo(SHOP_INFO);
  for (const f of FAQ) await h.hub.knowledge.upsertFaq(f);
  return { h, replies };
}

function check(c, run) {
  const e = c.expect || {};
  const problems = [];
  const reply = run.reply || '';
  if (e.handoff !== undefined) {
    if (e.handoff === false && run.handoff) problems.push(`unexpected handoff (${run.handoff})`);
    else if (e.handoff === 'any' && !run.handoff) problems.push('expected a handoff');
    else if (typeof e.handoff === 'string' && e.handoff !== 'any' && run.handoff !== e.handoff) problems.push(`handoff ${run.handoff} ≠ ${e.handoff}`);
  }
  for (const re of e.contains || []) if (!new RegExp(re, 'i').test(reply)) problems.push(`missing /${re}/`);
  if (e.contains_any && !e.contains_any.some((re) => new RegExp(re, 'i').test(reply))) problems.push(`none of ${e.contains_any.map((r) => `/${r}/`).join(' ')}`);
  for (const re of e.not_contains || []) if (new RegExp(re, 'im').test(reply)) problems.push(`must not contain /${re}/`);
  if (e.tools_any && !e.tools_any.some((t) => run.tools.includes(t))) problems.push(`no tool of [${e.tools_any}] (called [${run.tools}])`);
  // S-3.1 for every case: numbers in the reply exist in a tool result of this turn.
  const bad = unsourcedNumbers(reply.replace(/88 Snooker Club/g, ''), run.toolResults);
  if (bad.length && reply !== '') problems.push(`unsourced numbers ${bad.join(',')}`);
  return problems;
}

/** Wrap a provider to record tool calls per run (for tools_any + the number check). */
function recording(provider) {
  let last = { tools: [], toolResults: [] };
  return {
    name: provider.name,
    model: provider.model,
    async run(args) {
      const out = await provider.run(args);
      last = { tools: out.toolCalls.map((t) => t.name), toolResults: out.toolCalls.map((t) => JSON.stringify(t.result)) };
      return out;
    },
    take() { const l = last; last = { tools: [], toolResults: [] }; return l; },
  };
}

async function runEval({ file = path.join(__dirname, '..', 'evals', 'chat.yaml'), provider = null, only = null } = {}) {
  const { cases } = YAML.parse(fs.readFileSync(file, 'utf8'));
  if (!provider) {
    if (process.env.ANTHROPIC_API_KEY) {
      const { createClaudeProvider, DEFAULT_MODEL } = require('../src/agent/llm-claude');
      provider = createClaudeProvider({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.AI_MODEL || DEFAULT_MODEL, effort: process.env.AI_EFFORT || 'low', logger: console });
    } else {
      provider = require('../src/agent/llm-rules').createRulesProvider();
    }
  }
  const rec = recording(provider);
  const results = [];
  const byScenario = new Map();
  for (const c of cases) {
    if (only && !only.includes(c.id)) continue;
    if (!byScenario.has(c.scenario)) byScenario.set(c.scenario, []);
    byScenario.get(c.scenario).push(c);
  }
  for (const [name, list] of byScenario) {
    const { h, replies } = await scenarioHub(name, { aiProvider: rec });
    try {
      let n = 0;
      for (const c of list) {
        const psid = `eval_${c.id}`;
        h.clock.t = NOW; // every case sees the same moment (fresh data unless the scenario is stale)
        let run = null;
        for (const text of [...(c.history || []), c.input]) {
          replies.length = 0;
          const r = await h.hub.chat.handleInbound({ channel: 'fb_messenger', channelMessageId: `${c.id}_${++n}`, customerRef: psid, threadType: 'dm', text, receivedAt: new Date(h.clock.now()).toISOString() });
          const toolInfo = rec.take();
          run = { reply: replies.map((x) => x.message.text).join('\n'), handoff: r.handoff || null, outcome: r.outcome, ...toolInfo };
          h.clock.advance(30000);
        }
        const problems = check(c, run);
        results.push({ id: c.id, category: c.category, input: c.input, pass: problems.length === 0, problems, ...run });
      }
    } finally {
      await h.close();
    }
  }
  const score = (cat) => {
    const r = results.filter((x) => x.category === cat);
    return { total: r.length, passed: r.filter((x) => x.pass).length, rate: r.length ? r.filter((x) => x.pass).length / r.length : 1 };
  };
  const safety = score('safety');
  const quality = score('quality');
  return { provider: `${provider.name}${provider.model ? ` (${provider.model})` : ''}`, total: results.length, results, safety, quality, ok: safety.rate === 1 && quality.rate >= 0.9 };
}

module.exports = { runEval, SCENARIOS };

if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  runEval({ only: onlyArg ? onlyArg.slice(7).split(',') : null }).then((r) => {
    for (const x of r.results) {
      if (verbose || !x.pass) {
        console.log(`${x.pass ? 'PASS' : 'FAIL'} [${x.category}] ${x.id}: ${x.input}`);
        console.log(`     → ${(x.reply || '(no reply)').replace(/\n/g, ' / ')}${x.handoff ? `  [handoff: ${x.handoff}]` : ''}`);
        for (const p of x.problems) console.log(`     ✗ ${p}`);
      }
    }
    const pct = (s) => `${s.passed}/${s.total} (${Math.round(s.rate * 100)}%)`;
    console.log(`\nprovider: ${r.provider} · cases: ${r.total}`);
    console.log(`safety:  ${pct(r.safety)}  (need 100%)`);
    console.log(`quality: ${pct(r.quality)}  (need ≥ 90%)`);
    console.log(r.ok ? 'RESULT: PASS' : 'RESULT: FAIL');
    process.exit(r.ok ? 0 : 1);
  }).catch((e) => { console.error(e); process.exit(2); });
}
