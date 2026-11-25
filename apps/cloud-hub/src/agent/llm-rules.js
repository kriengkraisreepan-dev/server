'use strict';

// Free provider: no AI service, no cost. Recognises the common questions by keyword, calls the
// same tools as the Claude agent and fills fixed sentence templates with the tool results only,
// so it cannot invent anything. Anything it does not recognise is "unsure" (→ staff after 2x).
// Used when no ANTHROPIC_API_KEY is set, and as the deterministic AI in tests and evals.
const { replyLanguage } = require('./safety');

const INTENTS = [
  ['hours', /เปิด|ปิด|กี่โมง|เวลาทำการ|ถึงกี่|\bopen|\bclose|opening hours|what time/i],
  ['tables', /โต๊ะ|ว่าง|เต็ม|(?<!ไม้)คิว|รอนาน|table|available|free now|queue|busy|wait/i],
  ['price', /ราคา|เท่าไร|เท่าไหร่|กี่บาท|ชั่วโมงละ|ค่าโต๊ะ|price|how much|cost|rate/i],
  ['promo', /โปร|ส่วนลด|ลดราคา|promo|discount|deal|offer/i],
  ['location', /ที่อยู่|อยู่ไหน|อยู่ที่ไหน|อยู่ตรงไหน|ไปยังไง|เดินทาง|ที่จอด|จอดรถ|แผนที่|address|where|location|direction|parking|map/i],
  ['who', /บอท|bot|คนจริง|เป็นคน|\bai\b|robot|are you (a )?human/i],
  ['greeting', /^\s*(สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|hello\b|hi\b|hey\b)/i],
];

function detectIntents(text) {
  const t = String(text || '');
  const found = INTENTS.filter(([, re]) => re.test(t)).map(([name]) => name);
  // "เปิดกี่โมง" also matches "tables"-ish words rarely; hours wins over location only by order.
  return found;
}

const T = {
  th: {
    intro: 'สวัสดีครับ ผมเป็นผู้ช่วยอัตโนมัติของ 88 Snooker Club ครับ',
    who: 'ผมเป็นผู้ช่วยอัตโนมัติของ 88 Snooker Club ไม่ใช่พนักงานครับ ถ้าต้องการคุยกับพนักงาน พิมพ์ว่า "ขอคุยกับพนักงาน" ได้เลยครับ',
    menu: 'ถามเรื่องโต๊ะว่าง ราคา โปรโมชัน เวลาเปิด-ปิด หรือการเดินทางได้เลยครับ',
    noData: 'ตอนนี้ผมยังดึงข้อมูลจากร้านไม่ได้ครับ เดี๋ยวพนักงานจะตอบให้ครับ',
    unsure: 'ขออภัยครับ ผมยังไม่เข้าใจคำถาม ลองถามเรื่องโต๊ะว่าง ราคา โปรโมชัน เวลาเปิด-ปิด หรือการเดินทางได้ครับ',
    closed: 'ตอนนี้ร้านปิดอยู่ครับ',
    asOf: (t) => `(ข้อมูล ณ ${t} น.)`,
    kind: (k) => ({ snooker: 'สนุกเกอร์', pool: 'พูล' }[k] || k),
    tablesLine: (k) => k.available > 0
      ? `โต๊ะ${T.th.kind(k.kind)}ว่าง ${k.available} โต๊ะ (โต๊ะ ${k.availableTables.join(', ')})`
      : `โต๊ะ${T.th.kind(k.kind)}เต็มทุกโต๊ะ`,
    wait: (w) => w.cannotEstimate ? 'ตอนนี้ประเมินเวลารอไม่ได้ครับ' : `ถ้ารอ น่าจะประมาณ ${w.waitMinutesFrom}-${w.waitMinutesTo} นาทีครับ (เป็นค่าประมาณ อาจเปลี่ยนได้)`,
    queue: (n) => `มีคิวรออยู่ ${n} คิว`,
    priceLine: (p) => `${T.th.kind(p.kind)} ${p.label}${p.timeRange ? ` (${p.timeRange})` : ''} ชั่วโมงละ ${p.pricePerHourTHB} บาท`,
    noPromo: 'ตอนนี้ยังไม่มีโปรโมชันครับ',
    promoLine: (p) => `${p.title}: ${p.detail}${p.timeRange ? ` (${p.timeRange})` : ''} ถึง ${p.validTo}`,
    hours: (h) => `วันนี้ร้านเปิด ${h.open} - ${h.close} น.`,
    openNow: (o) => (o ? 'ตอนนี้ร้านเปิดอยู่ครับ' : 'ตอนนี้ร้านปิดอยู่ครับ'),
    noLocation: 'ขออภัยครับ ผมยังไม่มีข้อมูลที่อยู่ เดี๋ยวพนักงานจะตอบให้ครับ',
  },
  en: {
    intro: "Hi, I'm the automated assistant of 88 Snooker Club.",
    who: "I'm the automated assistant of 88 Snooker Club, not a staff member. Type \"talk to staff\" if you would like a person.",
    menu: 'You can ask about free tables, prices, promotions, opening hours or directions.',
    noData: "I can't get data from the shop right now. A staff member will reply soon.",
    unsure: "Sorry, I didn't understand. You can ask about free tables, prices, promotions, opening hours or directions.",
    closed: 'The club is closed right now.',
    asOf: (t) => `(data as of ${t})`,
    kind: (k) => k,
    tablesLine: (k) => k.available > 0
      ? `${k.available} ${k.kind} table(s) free (table ${k.availableTables.join(', ')})`
      : `all ${k.kind} tables are in use`,
    wait: (w) => w.cannotEstimate ? "I can't estimate the wait right now." : `The wait is about ${w.waitMinutesFrom}-${w.waitMinutesTo} minutes (estimate, may change).`,
    queue: (n) => `${n} group(s) waiting`,
    priceLine: (p) => `${p.kind} ${p.label}${p.timeRange ? ` (${p.timeRange})` : ''}: ${p.pricePerHourTHB} THB per hour`,
    noPromo: 'There is no promotion right now.',
    promoLine: (p) => `${p.title}: ${p.detail}${p.timeRange ? ` (${p.timeRange})` : ''} until ${p.validTo}`,
    hours: (h) => `Today we are open ${h.open} - ${h.close}.`,
    openNow: (o) => (o ? 'We are open now.' : 'We are closed right now.'),
    noLocation: "Sorry, I don't have the address yet. A staff member will reply soon.",
  },
};

function createRulesProvider() {
  return {
    name: 'rules',
    model: 'rules-v1',

    async run({ history, runTool }) {
      const last = [...history].reverse().find((m) => m.role === 'user');
      const text = last ? String(last.content) : '';
      const lang = replyLanguage(text);
      const L = T[lang];
      const toolCalls = [];
      const call = async (name, input = {}) => {
        const result = await runTool(name, input);
        toolCalls.push({ name, input, result });
        return result;
      };

      const intents = detectIntents(text);
      const parts = [];
      let stale = null;
      let noData = false;
      const noteStale = (r) => { if (r && r.stale) stale = r.asOfLocal; };

      for (const intent of intents) {
        if (intent === 'tables') {
          const r = await call('get_table_status');
          if (!r.available) { noData = true; continue; }
          noteStale(r);
          if (!r.shopOpenNow) {
            // Closed: free tables mean nothing; give the hours instead.
            const info = await call('get_shop_info');
            parts.push(L.closed + (info.fromShopPc && info.fromShopPc.todayHours ? ' ' + L.hours(info.fromShopPc.todayHours) : ''));
            continue;
          }
          parts.push(r.kinds.map(L.tablesLine).join(', ') + (lang === 'th' ? ' ครับ' : '.'));
          if (r.kinds.length && r.kinds.every((k) => k.available === 0)) {
            if (r.queueWaiting > 0) parts.push(L.queue(r.queueWaiting) + (lang === 'th' ? ' ครับ' : '.'));
            const w = await call('get_wait_estimate', { kind: 'any' });
            if (w.available) parts.push(L.wait(w));
          }
        } else if (intent === 'price') {
          const r = await call('get_price_list');
          if (!r.available || !r.prices.length) { noData = true; continue; }
          noteStale(r);
          parts.push(r.prices.map(L.priceLine).join(lang === 'th' ? ', ' : '; ') + (lang === 'th' ? ' ครับ' : '.'));
        } else if (intent === 'promo') {
          const r = await call('get_promotions');
          if (!r.available) { noData = true; continue; }
          noteStale(r);
          parts.push(r.promotions.length ? r.promotions.map(L.promoLine).join(' / ') : L.noPromo);
        } else if (intent === 'hours') {
          const r = await call('get_shop_info');
          const pc = r.fromShopPc;
          if (pc && pc.todayHours) parts.push(L.hours(pc.todayHours) + ' ' + L.openNow(pc.isOpenNow));
          else if (r.fromOwner.hours_text) parts.push(r.fromOwner.hours_text);
          else { noData = true; continue; }
          if (pc && pc.staffNote) parts.push(pc.staffNote);
          if (pc) noteStale(pc);
        } else if (intent === 'location') {
          const r = await call('get_shop_info');
          const o = r.fromOwner;
          const faq = await call('search_faq', { query: text });
          const bits = [o.address, o.directions].filter(Boolean);
          if (faq.results.length) bits.push(faq.results[0].answer);
          parts.push(bits.length ? bits.join('\n') : L.noLocation);
        } else if (intent === 'who') {
          parts.push(L.who);
        }
      }

      if (noData && parts.length === 0) {
        // No shop data: never guess (S-3.1) → staff answer, and they get notified.
        await call('handoff_to_staff', { reason: 'no_shop_data' });
        return { text: L.noData, toolCalls };
      }
      if (parts.length === 0 && !intents.includes('greeting')) {
        const faq = await call('search_faq', { query: text });
        if (faq.results.length) parts.push(faq.results[0].answer);
      }
      if (parts.length === 0) {
        if (intents.includes('greeting')) return { text: `${L.intro} ${L.menu}`, toolCalls };
        return { text: `${L.unsure} [UNSURE]`, toolCalls };
      }
      if (stale) parts.push(L.asOf(stale));
      return { text: [...new Set(parts)].join('\n'), toolCalls };
    },
  };
}

module.exports = { createRulesProvider, detectIntents };
