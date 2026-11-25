'use strict';

// Messenger webhook → conversation log → agent → reply. One customer's messages are handled
// strictly in order (per-customer queue) so replies never cross.
const { createRateLimiter } = require('../rate-limit');

const RATE_LIMIT = 20; // S-3.8: ≤ 20 messages per customer per 10 minutes
const RATE_WINDOW_MS = 10 * 60 * 1000;
const KILL_NOTICE_GAP_MS = 30 * 60 * 1000;

/**
 * @param {{ adapter: object, agent: object, conversations: object, killSwitches: object,
 *           audit: object, clock: { now(): number }, logger: object }} deps
 */
function createChatService({ adapter, agent, conversations, killSwitches, audit, clock, logger }) {
  const limiter = createRateLimiter({ limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS, clock });
  const queues = new Map();
  const pending = new Set();

  function enqueue(key, job) {
    const prev = queues.get(key) || Promise.resolve();
    const next = prev.then(job).catch((err) => logger.error('chat.job_failed', { error: err && err.message }));
    queues.set(key, next);
    pending.add(next);
    next.finally(() => {
      pending.delete(next);
      if (queues.get(key) === next) queues.delete(key);
    });
    return next;
  }

  async function send(conv, text, meta) {
    const r = await adapter.sendReply({ customerRef: conv.customerRef, text });
    logger.info('chat.reply_sent', { conversationId: conv.id, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
    await conversations.addMessage(conv.id, {
      role: 'ai',
      text,
      channelMessageId: r.messageId || null,
      meta: { ...meta, sent: r.ok, ...(r.ok ? {} : { sendError: r.error }) },
    });
    return r;
  }

  async function handleInbound(inbound) {
    if (!(await conversations.markProcessed(inbound.channel, inbound.channelMessageId))) {
      logger.info('chat.duplicate', { channel: inbound.channel });
      return { outcome: 'duplicate' };
    }
    const conv = await conversations.getOrCreate(inbound.channel, inbound.customerRef);
    const text = inbound.text || (inbound.attachments ? `[${inbound.attachments.map((a) => a.type).join(', ')}]` : '');
    await conversations.addMessage(conv.id, { role: 'customer', text, channelMessageId: inbound.channelMessageId, at: inbound.receivedAt });

    // Staff own this thread until they release it (S-3.4).
    if (conv.handoff) return { outcome: 'staff_handling' };

    // S-3.8: over the limit → stop auto replies and alert staff.
    if (!limiter.hit(`${inbound.channel}:${inbound.customerRef}`)) {
      await conversations.setHandoff(conv.id, 'rate_limit');
      await conversations.addMessage(conv.id, { role: 'system', text: 'ลูกค้าส่งข้อความถี่เกินกำหนด AI หยุดตอบและส่งให้พนักงาน', meta: { kind: 'rate_limit' } });
      return { outcome: 'rate_limited' };
    }

    // S-3.7: only inside the platform's messaging window.
    if (!(await adapter.canMessage(inbound.customerRef))) {
      logger.info('chat.outside_window', { conversationId: conv.id });
      return { outcome: 'outside_window' };
    }

    // S-1.5: AI chat switched off → a fixed "staff will reply" message (at most every 30 min).
    if (!(await killSwitches.isEnabled('ai_chat'))) {
      const recent = await conversations.recentMessages(conv.id, 20);
      const lastNotice = [...recent].reverse().find((m) => m.meta && m.meta.kind === 'kill_switch');
      if (lastNotice && clock.now() - Date.parse(lastNotice.at) < KILL_NOTICE_GAP_MS) return { outcome: 'kill_switch_quiet' };
      const lang = /[฀-๿]/.test(text) || !/[a-z]{2,}/i.test(text) ? 'th' : 'en';
      await send(conv, agent.TEXT[lang].killSwitch, { kind: 'kill_switch' });
      return { outcome: 'kill_switch' };
    }

    const result = await agent.respond(conv, inbound);
    if (result.handoff) {
      await conversations.setHandoff(conv.id, result.handoff);
      logger.info('chat.handoff', { conversationId: conv.id, reason: result.handoff });
    }
    if (result.reply) await send(conv, result.reply, { kind: result.kind, handoff: result.handoff, ...(result.meta || {}) });
    return { outcome: result.kind, handoff: result.handoff, reply: result.reply };
  }

  /** A message the Page sent that is not ours = a staff member answered in the Page inbox. */
  async function handleEcho(echo) {
    if (echo.fromOurApp) return;
    if (!(await conversations.markProcessed(`${echo.channel}:echo`, echo.channelMessageId))) return;
    const conv = await conversations.getOrCreate(echo.channel, echo.customerRef);
    await conversations.addMessage(conv.id, { role: 'staff', text: echo.text || '[attachment]', channelMessageId: echo.channelMessageId, at: echo.at });
    await conversations.setHandoff(conv.id, 'staff_replied', 'staff');
  }

  return {
    /** Process a verified webhook body. Returns when every message in it was handled. */
    async handleWebhook(body, { echoesEnabled = true } = {}) {
      const { messages, echoes } = adapter.parse(body);
      const jobs = [];
      if (echoesEnabled) for (const e of echoes) jobs.push(enqueue(`${e.channel}:${e.customerRef}`, () => handleEcho(e)));
      for (const m of messages) {
        jobs.push(enqueue(`${m.channel}:${m.customerRef}`, async () => {
          const r = await handleInbound(m);
          logger.info('chat.inbound', { outcome: r.outcome, handoff: r.handoff || null });
          return r;
        }));
      }
      return Promise.all(jobs);
    },
    handleInbound,
    /** Tests: wait until every queued job is done. */
    async idle() {
      while (pending.size) await Promise.all([...pending]);
    },
    audit,
  };
}

module.exports = { createChatService, RATE_LIMIT, RATE_WINDOW_MS };
