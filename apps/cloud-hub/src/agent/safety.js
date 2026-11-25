'use strict';

// Deterministic safety layer around the AI (SAFETY_RULES S-3). It runs for every provider,
// so the rules hold even if the model is tricked: the model may *write* anything, but a reply
// that breaks a rule is never sent.

/** Topics that always go to a human (S-3.4) + bookings (Phase A: no booking by chat). */
const HANDOFF_PATTERNS = [
  ['booking', /จอง|book(ing)?\b|reserv/i],
  ['asked_for_human', /คุยกับ(คน|พนักงาน|แอดมิน|เจ้าของ|ผู้จัดการ)|ขอ(สาย)?(คน|พนักงาน|แอดมิน)|เรียกพนักงาน|ติดต่อพนักงาน|ขอผู้จัดการ|real person|human|talk to (a |the )?(staff|person|someone|manager|admin)|speak to/i],
  ['complaint', /ร้องเรียน|ไม่พอใจ|แย่มาก|ผิดหวัง|บริการแย่|ห่วยแตก|complain|terrible service|very bad service/i],
  ['money', /คืนเงิน|เงินคืน|โอนเงิน|โอนผิด|จ่ายเงิน|ชำระเงิน|เก็บเงินเกิน|คิดเงินผิด|บิล|ใบเสร็จ|มัดจำ|refund|overcharg|charged twice|deposit|payment|receipt/i],
  ['lost_item', /ของหาย|ลืม.{0,20}ไว้|ทำ.{0,10}หาย|หาย.{0,10}(ไม้คิว|กระเป๋า|มือถือ|โทรศัพท์|กุญแจ)|lost (my|a|an)|left (my|a) .{0,20}(at|in)|forgot my/i],
  ['accident', /บาดเจ็บ|อุบัติเหตุ|เลือดออก|หกล้ม|ทะเลาะ|ต่อยกัน|injur|accident|bleeding|ambulance/i],
  ['threat', /ฆ่า|ระเบิด|เผาร้าน|เอาตาย|ขู่|แจ้งความ|ฟ้องร้อง|kill|bomb|threat|sue you|police/i],
];

function detectHandoff(text) {
  const t = String(text || '');
  for (const [reason, re] of HANDOFF_PATTERNS) if (re.test(t)) return reason;
  return null;
}

const THAI = /[฀-๿]/;
function isThai(text) {
  return THAI.test(String(text || ''));
}

/** Language we answer in: Thai if the customer writes any Thai, English if Latin only, else Thai. */
function replyLanguage(text) {
  const t = String(text || '');
  if (THAI.test(t)) return 'th';
  if (/[a-z]{2,}/i.test(t)) return 'en';
  return 'th';
}

/** All numbers in a text (Arabic and Thai digits), normalised: "1,200" → "1200", "๑๒๐" → "120". */
function numbersIn(text) {
  const s = String(text || '').replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)));
  const out = [];
  for (const m of s.matchAll(/\d[\d,]*(\.\d+)?/g)) out.push(m[0].replace(/,/g, '').replace(/\.0+$/, ''));
  return out;
}

/** Numbers that are safe without a source: the shop name and tiny counting words. */
const ALWAYS_OK_NUMBERS = new Set(['88', '0', '1', '2']);

/**
 * S-3.1: every number in the reply must come from a tool result this turn. The customer's own
 * message is deliberately NOT a source: "ราคา 10 บาทใช่ไหม" must not make 10 acceptable.
 * Returns the numbers that have no source.
 */
function unsourcedNumbers(reply, sources) {
  const allowed = new Set(ALWAYS_OK_NUMBERS);
  for (const src of sources) {
    for (const n of numbersIn(src)) {
      allowed.add(n);
      // "12:00" in a tool result also allows "12" and "00"; "02:00" allows "2" / "02" (2 AM).
      allowed.add(String(Number(n)));
    }
  }
  return numbersIn(reply).filter((n) => !allowed.has(n) && !allowed.has(String(Number(n))));
}

/** S-3.2: phrases that confirm a booking or promise something. Blocked unless a tool said so. */
const PROMISE_PATTERNS = [
  /จอง(ให้)?(เรียบร้อย|สำเร็จ|ได้แล้ว)|ยืนยันการจอง(แล้ว|ให้)|จองให้แล้ว|เก็บโต๊ะไว้ให้|กันโต๊ะไว้ให้/,
  /(booking|reservation) (is )?(confirmed|done)|i('ve| have) (booked|reserved)|table is reserved for you/i,
  /ให้ฟรี|ฟรีให้|ไม่คิดเงิน|ลดให้|ส่วนลดให้|ให้ส่วนลด|free of charge|on the house|i('ll| will) give you .{0,20}(discount|free)/i,
  /เลขบัญชี|โอนมาที่|โอนเข้า|บัตรเครดิต|เลขบัตร|card number|bank account|transfer (the money|to)/i,
];

const NEGATION = /ไม่|ยังไม่|มิได้|can't|cannot|can not|not|unable|no /i;

function brokenPromise(reply, sources) {
  const joined = sources.join('\n');
  return PROMISE_PATTERNS.some((re) => {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of reply.matchAll(g)) {
      if (joined.includes(m[0])) continue;
      // A refusal ("ไม่สามารถให้ส่วนลดได้", "we can't give a discount") is not a promise.
      const before = reply.slice(Math.max(0, m.index - 14), m.index);
      if (NEGATION.test(before)) continue;
      return true;
    }
    return false;
  });
}

/**
 * Prompt-leak guard (S-3.3 "บอก system prompt"): the reply must not contain the canary token
 * or any long run copied from the system prompt.
 */
function leaksPrompt(reply, systemPrompt, canary) {
  if (canary && reply.includes(canary)) return true;
  const r = reply.replace(/\s+/g, ' ');
  const p = systemPrompt.replace(/\s+/g, ' ');
  const W = 60;
  for (let i = 0; i + W <= p.length; i += 20) {
    if (r.includes(p.slice(i, i + W))) return true;
  }
  return false;
}

module.exports = {
  detectHandoff,
  isThai,
  replyLanguage,
  numbersIn,
  unsourcedNumbers,
  brokenPromise,
  leaksPrompt,
  HANDOFF_PATTERNS,
};
