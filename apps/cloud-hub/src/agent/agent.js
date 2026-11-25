'use strict';

// Chat agent: decides what (if anything) to answer one customer message.
// Order: deterministic checks → AI (Claude or the free rules provider) with tools → output
// guards. The guards are what make S-3.1/S-3.2/S-3.3 hold for any model.
const { SYSTEM_PROMPT, CANARY } = require('./system-prompt');
const safety = require('./safety');
const { hhmm } = require('./time');

const UNSURE_MARK = /\s*\[UNSURE\]\s*/g;
const INTRO_GAP_MS = 12 * 60 * 60 * 1000; // a "new conversation" = no AI reply in the last 12 h (S-3.6)
const HISTORY = 12;

const TEXT = {
  th: {
    intro: 'สวัสดีครับ ผมเป็นผู้ช่วยอัตโนมัติของ 88 Snooker Club ครับ',
    handoff: 'ขอบคุณที่ทักมาครับ ผมส่งเรื่องให้พนักงานแล้ว พนักงานจะตอบกลับโดยเร็วครับ',
    booking: 'ตอนนี้ยังรับจองผ่านแชทไม่ได้ครับ ผมส่งเรื่องให้พนักงานแล้ว พนักงานจะติดต่อกลับเพื่อช่วยเรื่องการจองโดยเร็วครับ',
    blocked: 'ขออภัยครับ เรื่องนี้ขอให้พนักงานเป็นคนตอบนะครับ พนักงานจะตอบกลับโดยเร็วครับ',
    error: 'ขออภัยครับ ตอนนี้ระบบตอบอัตโนมัติขัดข้อง พนักงานจะตอบกลับโดยเร็วครับ',
    killSwitch: 'ขอบคุณที่ทักมาครับ พนักงานจะตอบกลับโดยเร็วครับ',
    asOf: (t) => `(ข้อมูล ณ ${t} น. อาจไม่ใช่ล่าสุด แนะนำสอบถามพนักงานอีกครั้งครับ)`,
  },
  en: {
    intro: "Hi, I'm the automated assistant of 88 Snooker Club.",
    handoff: 'Thanks for your message. I have passed this to our staff, and a staff member will reply soon.',
    booking: "Bookings can't be made by chat yet. I have passed your request to our staff, and they will contact you soon to help with it.",
    blocked: 'Sorry, a staff member will answer this one. They will reply soon.',
    error: 'Sorry, the automatic reply is not working right now. A staff member will reply soon.',
    killSwitch: 'Thanks for your message. A staff member will reply soon.',
    asOf: (t) => `(data as of ${t}, may not be current; please check with staff)`,
  },
};

/** Build the message history for the model: customer → user, AI/staff → assistant. */
function toHistory(messages) {
  const out = [];
  for (const m of messages) {
    const role = m.role === 'customer' ? 'user' : m.role === 'ai' || m.role === 'staff' ? 'assistant' : null;
    if (!role || !m.text) continue;
    const content = m.role === 'staff' ? `[staff reply] ${m.text}` : m.text;
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content += '\n' + content;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/**
 * @param {{ provider: object, runTool: Function, conversations: object, clock: { now(): number }, logger: object }} deps
 */
function createAgent({ provider, runTool, conversations, clock, logger }) {
  /**
   * @param {object} conversation  conversations row (after the customer message was stored)
   * @param {{ text?: string, attachments?: object[] }} inbound
   * @returns {Promise<{ reply: string|null, handoff: string|null, kind: string, meta?: object }>}
   */
  async function respond(conversation, inbound) {
    const text = String(inbound.text || '').trim();
    const lang = safety.replyLanguage(text);
    const L = TEXT[lang];

    // Non-text: images/files need a person; stickers/likes get no reply.
    if (!text) {
      const needsHuman = (inbound.attachments || []).some((a) => a.type !== 'sticker');
      if (needsHuman) return { reply: L.handoff, handoff: 'attachment', kind: 'handoff' };
      return { reply: null, handoff: null, kind: 'ignored' };
    }

    // S-3.4 + bookings: these never reach the model.
    const pre = safety.detectHandoff(text);
    if (pre) return { reply: pre === 'booking' ? L.booking : L.handoff, handoff: pre, kind: 'handoff' };

    const recent = await conversations.recentMessages(conversation.id, HISTORY);
    const history = toHistory(recent);
    if (!history.length || history[history.length - 1].role !== 'user') history.push({ role: 'user', content: text });

    let handoffReason = null;
    const toolRunner = (name, input) => runTool(name, input, {
      onHandoff: async (reason) => { handoffReason = reason || 'other'; },
    });

    let result;
    try {
      result = await provider.run({ history, runTool: toolRunner });
    } catch (err) {
      logger.error('agent.provider_crashed', { error: err && err.message });
      result = { text: '', toolCalls: [], failed: 'crash' };
    }

    if (result.failed) return { reply: L.error, handoff: 'ai_error', kind: 'handoff', meta: { failed: result.failed } };
    if (handoffReason) {
      return { reply: handoffReason === 'booking' ? L.booking : L.handoff, handoff: handoffReason, kind: 'handoff', meta: { tools: result.toolCalls.map((c) => c.name) } };
    }

    let reply = String(result.text || '');
    const unsure = /\[UNSURE\]/.test(reply);
    reply = reply.replace(UNSURE_MARK, ' ').trim();
    const sources = result.toolCalls.map((c) => JSON.stringify(c.result));

    // Output guards (S-3.1 numbers, S-3.2 promises, S-3.3 prompt leak).
    const badNumbers = safety.unsourcedNumbers(reply, sources);
    const problems = [];
    if (!reply) problems.push('empty');
    if (badNumbers.length) problems.push('unsourced_numbers');
    if (safety.brokenPromise(reply, sources)) problems.push('promise');
    if (safety.leaksPrompt(reply, SYSTEM_PROMPT, CANARY)) problems.push('prompt_leak');
    if (problems.length) {
      logger.warn('agent.reply_blocked', { conversationId: conversation.id, problems });
      return { reply: L.blocked, handoff: 'reply_blocked', kind: 'handoff', meta: { problems, tools: result.toolCalls.map((c) => c.name) } };
    }

    // S-3.5: stale data → the reply must carry the data time.
    const staleCall = result.toolCalls.find((c) => c.result && (c.result.stale || (c.result.fromShopPc && c.result.fromShopPc.stale)));
    if (staleCall) {
      const asOf = staleCall.result.asOfLocal || staleCall.result.fromShopPc.asOfLocal;
      if (!reply.includes(asOf)) reply += '\n' + L.asOf(asOf);
    }

    // S-3.6: introduce ourselves at the start of a conversation.
    const lastAi = [...recent].reverse().find((m) => m.role === 'ai');
    const isNew = !lastAi || clock.now() - Date.parse(lastAi.at) > INTRO_GAP_MS;
    if (isNew && !/ผู้ช่วยอัตโนมัติ|automated assistant/i.test(reply)) reply = `${L.intro}\n${reply}`;

    // S-3.4: not sure twice in a row → staff.
    const streak = unsure ? conversation.unsureStreak + 1 : 0;
    if (streak !== conversation.unsureStreak) await conversations.setUnsureStreak(conversation.id, streak);
    if (streak >= 2) return { reply: L.handoff, handoff: 'unsure', kind: 'handoff', meta: { tools: result.toolCalls.map((c) => c.name) } };

    return { reply, handoff: null, kind: 'answer', meta: { unsure, tools: result.toolCalls.map((c) => c.name), stale: Boolean(staleCall), at: hhmm(clock.now()) } };
  }

  return { respond, TEXT };
}

module.exports = { createAgent, toHistory, TEXT };
