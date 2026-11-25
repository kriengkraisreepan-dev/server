'use strict';

// ChannelAdapter for Facebook Messenger (ARCHITECTURE §4.4).
// verifyWebhook: X-Hub-Signature-256 with the App Secret (S-5.1).
// canMessage: Meta's standard messaging window = 24 h after the customer's last message (S-3.7).
// sendReply: Graph API Send API. The Page token goes in the Authorization header, never in the
// URL or in logs (S-5.3).
const crypto = require('node:crypto');

const CHANNEL = 'fb_messenger';
const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;
const GRAPH_VERSION = 'v21.0';
const MAX_TEXT = 2000; // Send API limit for a text message

/** Constant-time check of `sha256=<hex>` against HMAC-SHA256(rawBody, appSecret). */
function verifySignature(rawBody, header, appSecret) {
  if (!appSecret || !Buffer.isBuffer(rawBody) || typeof header !== 'string') return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(m[1], 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/**
 * Meta delivers Messenger events in two shapes:
 *  - classic:  entry[].messaging[] = { sender, recipient, timestamp, message }
 *  - "changes" (newer app dashboard / Webhook fields): entry[].changes[] =
 *      { field: 'messages' | 'message_echoes', value: { sender, recipient, timestamp, message } }
 * Both become the same list of events here.
 */
function webhookEvents(body) {
  const out = [];
  for (const entry of Array.isArray(body && body.entry) ? body.entry : []) {
    if (!entry || typeof entry !== 'object') continue;
    if (Array.isArray(entry.messaging)) out.push(...entry.messaging);
    if (Array.isArray(entry.changes)) {
      for (const c of entry.changes) {
        if (!c || !c.value || typeof c.value !== 'object') continue;
        if (c.field === 'messages') out.push(c.value);
        else if (c.field === 'message_echoes') out.push({ ...c.value, isEcho: true });
      }
    }
  }
  return out;
}

/** Event timestamp → ms. Meta sends ms numbers; test events may send seconds or strings. */
function toMs(t) {
  const n = typeof t === 'string' && /^\d+$/.test(t) ? Number(t) : t;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

/**
 * Webhook JSON → InboundMessage[] (customer messages) and echoes[] (messages the Page sent,
 * e.g. a staff member answering from the Page inbox). Unknown event kinds are ignored.
 */
function parse(body, { pageAppId = null, now = Date.now() } = {}) {
  const messages = [];
  const echoes = [];
  if (!body || body.object !== 'page' || !Array.isArray(body.entry)) return { messages, echoes };
  for (const ev of webhookEvents(body)) {
    const msg = ev && ev.message;
    if (!msg || typeof msg.mid !== 'string') continue;
    const ts = toMs(ev.timestamp);
    const at = new Date(ts === null ? now : ts).toISOString();
    if (msg.is_echo || ev.isEcho) {
      // Echo of a Page message. Our own replies carry our app_id; anything else is a human.
      const recipient = ev.recipient && String(ev.recipient.id || '');
      if (!recipient) continue;
      echoes.push({
        channel: CHANNEL,
        channelMessageId: msg.mid,
        customerRef: recipient,
        fromOurApp: pageAppId != null && String(msg.app_id || '') === String(pageAppId),
        text: typeof msg.text === 'string' ? msg.text : '',
        at,
      });
      continue;
    }
    const sender = ev.sender && String(ev.sender.id || '');
    if (!sender) continue;
    const attachments = Array.isArray(msg.attachments)
      ? msg.attachments
        .filter((a) => a && typeof a.type === 'string')
        .map((a) => ({ type: ['image', 'video', 'file'].includes(a.type) ? a.type : 'sticker', url: String((a.payload && a.payload.url) || '') }))
      : undefined;
    messages.push({
      channel: CHANNEL,
      channelMessageId: msg.mid,
      customerRef: sender,
      threadType: 'dm',
      text: typeof msg.text === 'string' ? msg.text : undefined,
      attachments: attachments && attachments.length ? attachments : undefined,
      receivedAt: at,
    });
  }
  return { messages, echoes };
}

/**
 * @param {{ pageAccessToken?: string, appSecret?: string, pageAppId?: string,
 *           lastInboundAt: (customerRef: string) => Promise<string|null>,
 *           clock: { now(): number }, fetchImpl?: typeof fetch, logger: object }} options
 */
function createMessengerAdapter({ pageAccessToken, appSecret, pageAppId = null, lastInboundAt, clock, fetchImpl = fetch, logger }) {
  return {
    channel: CHANNEL,
    configured: Boolean(pageAccessToken && appSecret),

    verifyWebhook(rawBody, signatureHeader) {
      return verifySignature(rawBody, signatureHeader, appSecret);
    },

    parse(body) {
      return parse(body, { pageAppId, now: clock.now() });
    },

    async canMessage(customerRef) {
      const last = await lastInboundAt(customerRef);
      if (!last) return false;
      return clock.now() - Date.parse(last) <= MESSAGING_WINDOW_MS;
    },

    /** @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>} */
    async sendReply({ customerRef, text }) {
      if (!pageAccessToken) return { ok: false, error: 'not_configured' };
      const body = {
        recipient: { id: customerRef },
        messaging_type: 'RESPONSE',
        message: { text: String(text).slice(0, MAX_TEXT) },
      };
      try {
        const res = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/me/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${pageAccessToken}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Graph errors carry a code + type; never log the request (it has the customer id + token header).
          const err = data && data.error ? `graph_${data.error.code || res.status}` : `http_${res.status}`;
          logger.warn('fb.send_failed', { status: res.status, error: err });
          return { ok: false, error: err };
        }
        return { ok: true, messageId: data.message_id };
      } catch (e) {
        logger.warn('fb.send_failed', { error: e && e.name === 'TimeoutError' ? 'timeout' : 'network' });
        return { ok: false, error: 'network' };
      }
    },
  };
}

module.exports = { createMessengerAdapter, verifySignature, parse, webhookEvents, CHANNEL, MESSAGING_WINDOW_MS, GRAPH_VERSION };
