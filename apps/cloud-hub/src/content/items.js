'use strict';

// A6 post drafts (CONTENT_PIPELINE §3 ContentItem) and the approval queue.
//
// Every draft starts at L1: it waits for the owner (S-4.1). The owner can edit the caption and
// hashtags, pick a background image and a time, then approve or reject with a reason.
// Nothing here posts anything: A7 (publisher) takes `approved` items and re-checks them (S-4.3).
const ids = require('../ids');
const { generate, GeneratorError } = require('./generator');
const { checkDraft, parseHashtags, MAX_CAPTION } = require('./checks');
const { assertUsable, AssetError } = require('./assets');
const { localDate } = require('../agent/time');

const STATUSES = Object.freeze(['draft', 'pending_approval', 'approved', 'scheduled', 'published', 'failed', 'rejected', 'expired']);

/** §3 state machine. `scheduled`/`published`/`failed` are set by the publisher (A7). */
const TRANSITIONS = Object.freeze({
  draft: ['pending_approval', 'expired'],
  pending_approval: ['approved', 'rejected', 'expired'],
  approved: ['scheduled', 'published', 'failed', 'expired'],
  scheduled: ['published', 'failed', 'expired'],
  published: [],
  failed: [],
  rejected: [],
  expired: [],
});

/** BRIDGE_PROTOCOL §7 reason codes (same list the 88Snooker Approval tab will use). */
const REJECT_REASONS = Object.freeze(['table_full', 'closed', 'wrong_info', 'off_brand', 'wrong_numbers', 'other']);

// Facebook native scheduling allows 10 minutes to 30 days ahead (§7).
const MIN_SCHEDULE_AHEAD_MS = 10 * 60 * 1000;
const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_NOTE = 300;
const PATCH_KEYS = ['caption', 'hashtags', 'assetId', 'scheduledAt'];

class ItemError extends Error {
  constructor(code, status = 400, detail) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function canTransition(from, to) {
  return Boolean(TRANSITIONS[from] && TRANSITIONS[from].includes(to));
}

const COLS = `id, template_id, status, autonomy_level, summary, caption, hashtags, template_data, asset_id, image_prompt,
  source_snapshot, variant, scheduled_at, expires_at, approved_by, approved_at, reject_reason_code, reject_note, edited,
  created_by, created_at, updated_at`;

const iso = (v) => (v ? new Date(v).toISOString() : null);

function toItem(r) {
  return {
    id: r.id,
    templateId: r.template_id,
    status: r.status,
    autonomyLevel: r.autonomy_level,
    summary: r.summary,
    caption: r.caption,
    hashtags: r.hashtags,
    templateData: r.template_data,
    assetId: r.asset_id,
    imagePrompt: r.image_prompt,
    sourceSnapshot: r.source_snapshot,
    variant: r.variant,
    scheduledAt: iso(r.scheduled_at),
    expiresAt: iso(r.expires_at),
    approvedBy: r.approved_by,
    approvedAt: iso(r.approved_at),
    rejectReason: r.reject_reason_code,
    rejectNote: r.reject_note,
    edited: r.edited,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/** Rebuild the generator request from what the item was made from (for "ร่างใหม่"). */
function requestOf(item) {
  const s = item.sourceSnapshot || {};
  if (item.templateId === 'happy_hour') return { templateId: 'happy_hour', promotionId: s.promotionId };
  if (item.templateId === 'tournament') return { templateId: 'tournament', tournament: s.data && s.data.tournament };
  return { templateId: item.templateId };
}

function availableCount(snapshot) {
  return snapshot ? snapshot.tables.filter((t) => t.status === 'available').length : null;
}

/**
 * @param {{ db: object, audit: object, clock: { now(): number }, snapshots: object, assets: object, onCreated?: (item) => void }} deps
 */
function createContentItems({ db, audit, clock, snapshots, assets, onCreated = () => {} }) {
  async function load(id, q = db) {
    const { rows } = await q.query(`SELECT ${COLS} FROM content_items WHERE id = $1`, [String(id)]);
    return rows[0] ? toItem(rows[0]) : null;
  }

  /** Load for a change: must exist, must be waiting for approval and not past its expiry. */
  async function loadPending(id) {
    await expireDue();
    const item = await load(id);
    if (!item) throw new ItemError('not_found', 404);
    if (item.status !== 'pending_approval') throw new ItemError('not_pending', 409, { status: item.status });
    return item;
  }

  function runGenerator(request, variant) {
    return snapshots.latestActive().then((snapshot) => {
      try {
        return generate(request, { snapshot, now: clock.now(), variant });
      } catch (err) {
        if (err instanceof GeneratorError) throw new ItemError(err.code, 409, err.detail);
        throw err;
      }
    });
  }

  function assertChecks(draft) {
    const issues = checkDraft(draft);
    if (issues.length) throw new ItemError('checks_failed', 422, issues);
  }

  async function assertAsset(assetId, templateId) {
    const a = await assets.get(assetId);
    if (!a) throw new ItemError('asset_not_found', 404);
    try {
      assertUsable(a, templateId); // S-4.5
    } catch (err) {
      if (err instanceof AssetError) throw new ItemError(err.code, err.status);
      throw err;
    }
  }

  function cleanSchedule(value, expiresAt) {
    if (value === null || value === undefined || value === '') return null;
    const t = Date.parse(String(value));
    if (Number.isNaN(t)) throw new ItemError('bad_scheduled_at');
    const now = clock.now();
    if (t < now + MIN_SCHEDULE_AHEAD_MS) throw new ItemError('scheduled_too_soon');
    if (t > now + MAX_SCHEDULE_AHEAD_MS) throw new ItemError('scheduled_too_far');
    if (t >= Date.parse(expiresAt)) throw new ItemError('scheduled_after_expiry'); // S-4.4
    return new Date(t).toISOString();
  }

  /** S-4.4: anything past expiresAt and not yet posted becomes `expired`. */
  async function expireDue() {
    const now = new Date(clock.now());
    return db.tx(async (t) => {
      const { rows } = await t.query(
        `UPDATE content_items SET status = 'expired', updated_at = $1
         WHERE status IN ('draft', 'pending_approval', 'approved', 'scheduled') AND expires_at <= $1
         RETURNING id, status`,
        [now],
      );
      for (const r of rows) await audit.record({ actor: 'system', action: 'content.expired', target: r.id }, t);
      return rows.map((r) => r.id);
    });
  }

  const api = {
    STATUSES,
    REJECT_REASONS,
    expireDue,

    /**
     * Generate a draft from the latest shop data and put it in the approval queue (L1).
     * @param {{ templateId: string, promotionId?: string, tournament?: object }} request
     */
    async create(request, actor = 'owner') {
      const now = clock.now();
      if (request && request.templateId === 'daily_tables') {
        // §5 T1: at most one "โต๊ะว่างวันนี้" post per day.
        const { rows } = await db.query(
          `SELECT created_at FROM content_items WHERE template_id = 'daily_tables' AND status IN ('approved', 'scheduled', 'published')
           ORDER BY created_at DESC LIMIT 5`,
        );
        if (rows.some((r) => localDate(new Date(r.created_at).getTime()) === localDate(now))) throw new ItemError('daily_tables_already_today', 409);
      }
      const draft = await runGenerator(request, 0);
      assertChecks(draft); // a generator bug must never reach the queue
      const id = 'ci_' + ids.ulid(now);
      await db.tx(async (t) => {
        await t.query(
          `INSERT INTO content_items (id, template_id, status, autonomy_level, summary, caption, hashtags, template_data, image_prompt,
             source_snapshot, variant, expires_at, created_by, created_at, updated_at)
           VALUES ($1, $2, 'pending_approval', 'L1', $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, 0, $9, $10, $11, $11)`,
          [id, draft.templateId, draft.summary, draft.caption, JSON.stringify(draft.hashtags), JSON.stringify(draft.templateData),
            draft.imagePrompt, JSON.stringify(draft.sourceSnapshot), new Date(draft.expiresAt), actor, new Date(now)],
        );
        await audit.record({ actor, action: 'content.created', target: id, detail: { templateId: draft.templateId, seq: draft.sourceSnapshot.seq } }, t);
      });
      const item = await load(id);
      try { onCreated(item); } catch { /* notification only */ }
      return item;
    },

    async list({ status, limit = 50 } = {}) {
      await expireDue();
      const lim = Math.min(Math.max(1, Number(limit) | 0), 200);
      const { rows } = status
        ? await db.query(`SELECT ${COLS} FROM content_items WHERE status = $1 ORDER BY created_at DESC LIMIT $2`, [String(status), lim])
        : await db.query(`SELECT ${COLS} FROM content_items ORDER BY created_at DESC LIMIT $1`, [lim]);
      return rows.map(toItem);
    },

    async get(id) {
      await expireDue();
      return load(id);
    },

    /**
     * The item plus what the owner should see before approving: current check results and
     * whether the shop data changed since the draft was made (daily_tables).
     */
    async review(id) {
      const item = await this.get(id);
      if (!item) return null;
      const issues = checkDraft(item);
      let dataChanged = false;
      if (item.templateId === 'daily_tables' && item.status === 'pending_approval') {
        const latest = await snapshots.latestActive();
        dataChanged = !latest || latest.stale || availableCount(latest.snapshot) !== item.templateData.available;
      }
      return { item, issues, dataChanged };
    },

    async pendingCount() {
      await expireDue();
      const { rows: [r] } = await db.query("SELECT COUNT(*)::int AS n FROM content_items WHERE status = 'pending_approval'");
      return r.n;
    },

    /** Owner edits: caption, hashtags, background image, time. Checks run on every change. */
    async update(id, patch, actor = 'owner') {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new ItemError('bad_request');
      const unknown = Object.keys(patch).filter((k) => !PATCH_KEYS.includes(k));
      if (unknown.length) throw new ItemError('unknown_field', 400, { fields: unknown }); // e.g. autonomyLevel (S-4.1)
      const item = await loadPending(id);
      const next = { ...item };
      if (patch.caption !== undefined) {
        if (typeof patch.caption !== 'string') throw new ItemError('bad_caption');
        next.caption = patch.caption.replace(/\r\n/g, '\n').trim().slice(0, MAX_CAPTION + 1);
      }
      if (patch.hashtags !== undefined) next.hashtags = parseHashtags(patch.hashtags);
      if (patch.assetId !== undefined) {
        next.assetId = patch.assetId ? String(patch.assetId) : null;
        if (next.assetId) await assertAsset(next.assetId, item.templateId);
      }
      if (patch.scheduledAt !== undefined) next.scheduledAt = cleanSchedule(patch.scheduledAt, item.expiresAt);
      assertChecks(next);
      const textEdited = next.caption !== item.caption || JSON.stringify(next.hashtags) !== JSON.stringify(item.hashtags);
      await db.tx(async (t) => {
        const { rowCount } = await t.query(
          `UPDATE content_items SET caption = $2, hashtags = $3::jsonb, asset_id = $4, scheduled_at = $5, edited = edited OR $6, updated_at = $7
           WHERE id = $1 AND status = 'pending_approval'`,
          [id, next.caption, JSON.stringify(next.hashtags), next.assetId, next.scheduledAt ? new Date(next.scheduledAt) : null, textEdited, new Date(clock.now())],
        );
        if (rowCount !== 1) throw new ItemError('not_pending', 409);
        await audit.record({ actor, action: 'content.edited', target: id, detail: { fields: Object.keys(patch) } }, t);
      });
      return load(id);
    },

    /** "ร่างใหม่": new wording from the latest shop data. Keeps the chosen image when still allowed. */
    async regenerate(id, actor = 'owner') {
      const item = await loadPending(id);
      const variant = item.variant + 1;
      const draft = await runGenerator(requestOf(item), variant);
      assertChecks(draft);
      let scheduledAt = item.scheduledAt;
      if (scheduledAt && Date.parse(scheduledAt) >= Date.parse(draft.expiresAt)) scheduledAt = null;
      await db.tx(async (t) => {
        const { rowCount } = await t.query(
          `UPDATE content_items SET summary = $2, caption = $3, hashtags = $4::jsonb, template_data = $5::jsonb, image_prompt = $6,
             source_snapshot = $7::jsonb, variant = $8, expires_at = $9, scheduled_at = $10, edited = false, updated_at = $11
           WHERE id = $1 AND status = 'pending_approval'`,
          [id, draft.summary, draft.caption, JSON.stringify(draft.hashtags), JSON.stringify(draft.templateData), draft.imagePrompt,
            JSON.stringify(draft.sourceSnapshot), variant, new Date(draft.expiresAt), scheduledAt ? new Date(scheduledAt) : null, new Date(clock.now())],
        );
        if (rowCount !== 1) throw new ItemError('not_pending', 409);
        await audit.record({ actor, action: 'content.regenerated', target: id, detail: { variant, seq: draft.sourceSnapshot.seq } }, t);
      });
      return load(id);
    },

    /** Owner approves. Checks, expiry and (daily_tables) the live table count are verified again. */
    async approve(id, { scheduledAt } = {}, actor = 'owner') {
      const item = await loadPending(id);
      assertChecks(item);
      if (item.assetId) await assertAsset(item.assetId, item.templateId);
      if (item.templateId === 'daily_tables') {
        const latest = await snapshots.latestActive();
        if (!latest || latest.stale || availableCount(latest.snapshot) !== item.templateData.available) {
          throw new ItemError('shop_data_changed', 409);
        }
      }
      const when = scheduledAt !== undefined ? cleanSchedule(scheduledAt, item.expiresAt) : item.scheduledAt;
      if (when) cleanSchedule(when, item.expiresAt);
      await db.tx(async (t) => {
        const now = new Date(clock.now());
        const { rowCount } = await t.query(
          `UPDATE content_items SET status = 'approved', approved_by = $2, approved_at = $3, scheduled_at = $4, updated_at = $3
           WHERE id = $1 AND status = 'pending_approval'`,
          [id, actor, now, when ? new Date(when) : null],
        );
        if (rowCount !== 1) throw new ItemError('not_pending', 409);
        await audit.record({ actor, action: 'content.approved', target: id, detail: { templateId: item.templateId, edited: item.edited, scheduled: Boolean(when) } }, t);
      });
      return load(id);
    },

    /** Owner rejects with a reason (kept to improve the wording later). */
    async reject(id, { reasonCode, note } = {}, actor = 'owner') {
      if (!REJECT_REASONS.includes(reasonCode)) throw new ItemError('bad_reason');
      if (note !== undefined && note !== null && typeof note !== 'string') throw new ItemError('bad_note');
      const cleanNote = note ? note.trim().slice(0, MAX_NOTE) : null;
      await loadPending(id);
      await db.tx(async (t) => {
        const { rowCount } = await t.query(
          `UPDATE content_items SET status = 'rejected', reject_reason_code = $2, reject_note = $3, updated_at = $4
           WHERE id = $1 AND status = 'pending_approval'`,
          [id, reasonCode, cleanNote, new Date(clock.now())],
        );
        if (rowCount !== 1) throw new ItemError('not_pending', 409);
        await audit.record({ actor, action: 'content.rejected', target: id, detail: { reasonCode } }, t);
      });
      return load(id);
    },

    /** For the publisher (A7) and tests: move along the state machine only. */
    async transition(id, to, actor = 'system') {
      return db.tx(async (t) => {
        const cur = await load(id, t);
        if (!cur) throw new ItemError('not_found', 404);
        if (!canTransition(cur.status, to)) throw new ItemError('bad_transition', 409, { from: cur.status, to });
        const { rowCount } = await t.query('UPDATE content_items SET status = $3, updated_at = $4 WHERE id = $1 AND status = $2', [id, cur.status, to, new Date(clock.now())]);
        if (rowCount !== 1) throw new ItemError('conflict', 409);
        await audit.record({ actor, action: 'content.status', target: id, detail: { from: cur.status, to } }, t);
        return load(id, t);
      });
    },
  };
  return api;
}

module.exports = { createContentItems, ItemError, STATUSES, TRANSITIONS, REJECT_REASONS, canTransition };
