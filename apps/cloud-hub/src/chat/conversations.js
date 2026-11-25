'use strict';

// Conversation log + handoff state + webhook dedupe (A4; S-3.4, S-6.2, S-6.3).
const ids = require('../ids');

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 90; // S-6.2
const MAX_TEXT = 2000;

function rowToConversation(r) {
  return {
    id: r.id,
    channel: r.channel,
    customerRef: r.customer_ref,
    createdAt: new Date(r.created_at).toISOString(),
    lastInboundAt: r.last_inbound_at ? new Date(r.last_inbound_at).toISOString() : null,
    lastActivityAt: new Date(r.last_activity_at).toISOString(),
    handoff: r.handoff,
    handoffReason: r.handoff_reason,
    handoffAt: r.handoff_at ? new Date(r.handoff_at).toISOString() : null,
    unsureStreak: Number(r.unsure_streak),
  };
}

/** For the Admin web list: the PSID is an opaque number; show only its last 4 digits. */
function maskRef(ref) {
  const s = String(ref);
  return s.length <= 4 ? s : '…' + s.slice(-4);
}

function createConversations({ db, audit, clock, retentionDays = DEFAULT_RETENTION_DAYS }) {
  const now = () => new Date(clock.now());

  return {
    /**
     * Record a platform message id. Returns false if it was seen before (duplicate webhook).
     */
    async markProcessed(channel, channelMessageId) {
      const { rows } = await db.query(
        `INSERT INTO processed_inbound (channel, channel_message_id, received_at) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING channel_message_id`,
        [channel, channelMessageId, now()],
      );
      return rows.length === 1;
    },

    async getOrCreate(channel, customerRef) {
      const id = `conv_${ids.ulid(clock.now())}`;
      await db.query(
        `INSERT INTO conversations (id, channel, customer_ref, created_at, last_activity_at)
         VALUES ($1, $2, $3, $4, $4) ON CONFLICT (channel, customer_ref) DO NOTHING`,
        [id, channel, customerRef, now()],
      );
      const { rows } = await db.query('SELECT * FROM conversations WHERE channel = $1 AND customer_ref = $2', [channel, customerRef]);
      return rowToConversation(rows[0]);
    },

    async get(id) {
      const { rows } = await db.query('SELECT * FROM conversations WHERE id = $1', [id]);
      return rows.length ? rowToConversation(rows[0]) : null;
    },

    /** Append one message. role: customer | ai | staff | system. */
    async addMessage(conversationId, { role, text, channelMessageId = null, meta = {}, at = null }) {
      const when = at ? new Date(at) : now();
      await db.query(
        'INSERT INTO chat_messages (conversation_id, at, role, text, channel_message_id, meta) VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
        [conversationId, when, role, String(text || '').slice(0, MAX_TEXT), channelMessageId, JSON.stringify(meta)],
      );
      if (role === 'customer') {
        await db.query('UPDATE conversations SET last_inbound_at = $2, last_activity_at = $2 WHERE id = $1', [conversationId, when]);
      } else {
        await db.query('UPDATE conversations SET last_activity_at = $2 WHERE id = $1', [conversationId, when]);
      }
    },

    /** Most recent `limit` messages, oldest first (short-term memory for the agent). */
    async recentMessages(conversationId, limit = 12) {
      const { rows } = await db.query(
        'SELECT id, at, role, text, meta FROM chat_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2',
        [conversationId, limit],
      );
      return rows.reverse().map((r) => ({ id: Number(r.id), at: new Date(r.at).toISOString(), role: r.role, text: r.text, meta: r.meta }));
    },

    async setHandoff(conversationId, reason, actor = 'system') {
      const { rows } = await db.query(
        `UPDATE conversations SET handoff = true, handoff_reason = $2, handoff_at = $3, unsure_streak = 0
         WHERE id = $1 AND handoff = false RETURNING id`,
        [conversationId, reason, now()],
      );
      if (rows.length) await audit.record({ actor, action: 'chat.handoff', target: conversationId, detail: { reason } });
      return rows.length === 1;
    },

    /** Staff hands the thread back to the AI. */
    async release(conversationId, actor = 'owner') {
      const { rows } = await db.query(
        'UPDATE conversations SET handoff = false, handoff_reason = NULL, handoff_at = NULL, unsure_streak = 0 WHERE id = $1 RETURNING id',
        [conversationId],
      );
      if (rows.length) await audit.record({ actor, action: 'chat.released', target: conversationId });
      return rows.length === 1;
    },

    async setUnsureStreak(conversationId, n) {
      await db.query('UPDATE conversations SET unsure_streak = $2 WHERE id = $1', [conversationId, n]);
    },

    /** Admin list, newest activity first, with the last message text. */
    async list({ limit = 50, handoffOnly = false } = {}) {
      const { rows } = await db.query(
        `SELECT c.*, (SELECT text FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_text
         FROM conversations c WHERE c.channel <> 'admin_test' ${handoffOnly ? 'AND c.handoff = true' : ''}
         ORDER BY c.last_activity_at DESC LIMIT $1`,
        [Math.min(Math.max(1, limit | 0), 200)],
      );
      return rows.map((r) => ({ ...rowToConversation(r), customerRef: undefined, customerLabel: maskRef(r.customer_ref), lastText: r.last_text || '' }));
    },

    async countHandoff() {
      const { rows } = await db.query("SELECT count(*)::int AS n FROM conversations WHERE handoff = true AND channel <> 'admin_test'");
      return rows[0].n;
    },

    /** S-6.3: delete a customer's conversation on request. */
    async remove(conversationId, actor = 'owner') {
      const { rows } = await db.query('DELETE FROM conversations WHERE id = $1 RETURNING id', [conversationId]);
      if (rows.length) await audit.record({ actor, action: 'chat.deleted', target: conversationId });
      return rows.length === 1;
    },

    /** S-6.2: drop messages older than the retention period, and conversations left empty. */
    async purgeOld() {
      const cutoff = new Date(clock.now() - retentionDays * DAY);
      const m = await db.query('DELETE FROM chat_messages WHERE at < $1 RETURNING id', [cutoff]);
      const c = await db.query(
        'DELETE FROM conversations c WHERE last_activity_at < $1 AND NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id) RETURNING id',
        [cutoff],
      );
      await db.query('DELETE FROM processed_inbound WHERE received_at < $1', [new Date(clock.now() - 7 * DAY)]);
      return { messages: m.rows.length, conversations: c.rows.length };
    },
  };
}

module.exports = { createConversations, maskRef, DEFAULT_RETENTION_DAYS };
