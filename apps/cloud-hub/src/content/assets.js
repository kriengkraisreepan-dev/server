'use strict';

// A5 asset library (CONTENT_PIPELINE §3 `Asset`). Images the owner uploads in the Admin web,
// stored in Postgres. Every asset says where it came from (`source`) and whether people in it
// gave permission (`consent`). An asset with consent 'missing' can never be used in a post (S-4.5).
const crypto = require('node:crypto');
const ids = require('../ids');

const SOURCES = Object.freeze(['real', 'ai', 'template']);
const CONSENTS = Object.freeze(['not_needed', 'recorded', 'missing']);
const MAX_BYTES = 5 * 1024 * 1024;
/** Keep well under the free database size (Supabase free = 500 MB in total). */
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_TAGS = 12;
const MAX_TAG_LEN = 30;
const MAX_NOTE = 300;
const MIN_SIDE = 200;
const MAX_SIDE = 8000;

class AssetError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/**
 * Find the image type and size from the file bytes themselves (never trust the browser's
 * content-type or file name). Supports JPEG, PNG and WebP. Returns null for anything else.
 * @param {Buffer} buf
 * @returns {{ mime: string, width: number, height: number } | null}
 */
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 32) return null;
  // PNG: signature + IHDR first.
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && buf.toString('latin1', 12, 16) === 'IHDR') {
    return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: walk the markers to the first SOFn.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { mime: 'image/jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X chunk.
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = buf.toString('latin1', 12, 16);
    if (chunk === 'VP8 ' && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      return { mime: 'image/webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L' && buf[20] === 0x2f) {
      const b = buf.readUInt32LE(21);
      return { mime: 'image/webp', width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      return { mime: 'image/webp', width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    }
  }
  return null;
}

function cleanTags(tags) {
  if (tags === undefined || tags === null) return [];
  const list = Array.isArray(tags) ? tags : String(tags).split(',');
  const out = [];
  for (const t of list) {
    if (typeof t !== 'string') throw new AssetError('bad_tags');
    const v = t.trim().toLowerCase();
    if (!v) continue;
    if (v.length > MAX_TAG_LEN) throw new AssetError('bad_tags');
    if (!out.includes(v)) out.push(v);
  }
  if (out.length > MAX_TAGS) throw new AssetError('bad_tags');
  return out;
}

function cleanAllowed(list, templateIds) {
  if (list === undefined || list === null || list === '') return null;
  const arr = Array.isArray(list) ? list : String(list).split(',').map((s) => s.trim()).filter(Boolean);
  if (arr.length === 0) return null;
  for (const t of arr) if (!templateIds.includes(t)) throw new AssetError('unknown_template');
  return [...new Set(arr)];
}

function cleanNote(note) {
  if (note === undefined || note === null) return '';
  if (typeof note !== 'string' || note.length > MAX_NOTE) throw new AssetError('bad_note');
  return note.trim();
}

function toAsset(r) {
  return {
    id: r.id,
    kind: r.kind,
    mime: r.mime,
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    source: r.source,
    consent: r.consent,
    tags: r.tags || [],
    allowedTemplates: r.allowed_templates || null,
    note: r.note,
    uploadedBy: r.uploaded_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    usable: r.consent !== 'missing',
  };
}

const META_COLS = 'id, kind, mime, width, height, bytes, source, consent, tags, allowed_templates, note, uploaded_by, created_at, updated_at';

/**
 * @param {{ db: object, audit: object, clock: { now(): number }, templateIds: string[] }} deps
 */
function createAssets({ db, audit, clock, templateIds }) {
  return {
    SOURCES,
    CONSENTS,
    MAX_BYTES,

    /**
     * @param {{ data: Buffer, source: string, consent: string, tags?: string[]|string,
     *           allowedTemplates?: string[]|string, note?: string }} input
     */
    async upload(input, actor = 'owner') {
      const data = input && input.data;
      if (!Buffer.isBuffer(data) || data.length === 0) throw new AssetError('file_required');
      if (data.length > MAX_BYTES) throw new AssetError('too_large', 413);
      const info = sniffImage(data);
      if (!info) throw new AssetError('unsupported_type', 415);
      if (info.width < MIN_SIDE || info.height < MIN_SIDE) throw new AssetError('image_too_small');
      if (info.width > MAX_SIDE || info.height > MAX_SIDE) throw new AssetError('image_too_big');
      if (!SOURCES.includes(input.source)) throw new AssetError('bad_source');
      if (!CONSENTS.includes(input.consent)) throw new AssetError('bad_consent');
      const tags = cleanTags(input.tags);
      const allowed = cleanAllowed(input.allowedTemplates, templateIds);
      const note = cleanNote(input.note);

      const { rows: [{ total }] } = await db.query('SELECT COALESCE(SUM(bytes), 0)::bigint AS total FROM assets');
      if (Number(total) + data.length > MAX_TOTAL_BYTES) throw new AssetError('storage_full', 507);

      const id = `ast_${ids.ulid(clock.now())}`;
      const now = new Date(clock.now());
      const sha256 = crypto.createHash('sha256').update(data).digest('hex');
      await db.tx(async (t) => {
        await t.query(
          `INSERT INTO assets (id, kind, mime, width, height, bytes, sha256, data, source, consent, tags, allowed_templates, note, uploaded_by, created_at, updated_at)
           VALUES ($1, 'image', $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $14)`,
          [id, info.mime, info.width, info.height, data.length, sha256, data, input.source, input.consent,
            JSON.stringify(tags), allowed ? JSON.stringify(allowed) : null, note, actor, now],
        );
        await audit.record({ actor, action: 'asset.uploaded', target: id, detail: { source: input.source, consent: input.consent, bytes: data.length } }, t);
      });
      return this.get(id);
    },

    async list() {
      const { rows } = await db.query(`SELECT ${META_COLS} FROM assets ORDER BY created_at DESC, id DESC`);
      return rows.map(toAsset);
    },

    async get(id) {
      const { rows } = await db.query(`SELECT ${META_COLS} FROM assets WHERE id = $1`, [String(id)]);
      return rows[0] ? toAsset(rows[0]) : null;
    },

    /** Metadata + bytes. */
    async getWithData(id) {
      const { rows } = await db.query(`SELECT ${META_COLS}, data FROM assets WHERE id = $1`, [String(id)]);
      if (!rows[0]) return null;
      return { ...toAsset(rows[0]), data: Buffer.from(rows[0].data) };
    },

    /** Change source / consent / tags / allowedTemplates / note. The image itself never changes. */
    async update(id, patch, actor = 'owner') {
      const cur = await this.get(id);
      if (!cur) return null;
      if (!patch || typeof patch !== 'object') throw new AssetError('bad_request');
      const next = { ...cur };
      if (patch.source !== undefined) {
        if (!SOURCES.includes(patch.source)) throw new AssetError('bad_source');
        next.source = patch.source;
      }
      if (patch.consent !== undefined) {
        if (!CONSENTS.includes(patch.consent)) throw new AssetError('bad_consent');
        next.consent = patch.consent;
      }
      if (patch.tags !== undefined) next.tags = cleanTags(patch.tags);
      if (patch.allowedTemplates !== undefined) next.allowedTemplates = cleanAllowed(patch.allowedTemplates, templateIds);
      if (patch.note !== undefined) next.note = cleanNote(patch.note);
      await db.tx(async (t) => {
        await t.query(
          `UPDATE assets SET source = $2, consent = $3, tags = $4::jsonb, allowed_templates = $5::jsonb, note = $6, updated_at = $7 WHERE id = $1`,
          [id, next.source, next.consent, JSON.stringify(next.tags), next.allowedTemplates ? JSON.stringify(next.allowedTemplates) : null, next.note, new Date(clock.now())],
        );
        await audit.record({ actor, action: 'asset.updated', target: id, detail: { source: next.source, consent: next.consent, consentBefore: cur.consent } }, t);
      });
      return this.get(id);
    },

    async remove(id, actor = 'owner') {
      return db.tx(async (t) => {
        const { rows } = await t.query('DELETE FROM assets WHERE id = $1 RETURNING id', [String(id)]);
        if (!rows[0]) return false;
        await audit.record({ actor, action: 'asset.deleted', target: id }, t);
        return true;
      });
    },

    /**
     * The one gate every template use goes through (S-4.5). Throws AssetError when the asset
     * cannot be used for this template; returns the asset with its bytes otherwise.
     */
    async loadForTemplate(id, templateId) {
      const a = await this.getWithData(id);
      if (!a) throw new AssetError('asset_not_found', 404);
      assertUsable(a, templateId);
      return a;
    },

    async usage() {
      const { rows: [r] } = await db.query('SELECT COUNT(*)::int AS count, COALESCE(SUM(bytes), 0)::bigint AS total FROM assets');
      return { count: r.count, bytes: Number(r.total), maxBytes: MAX_TOTAL_BYTES };
    },
  };
}

/** S-4.5: no image of people without recorded consent; respect the per-asset template list. */
function assertUsable(asset, templateId) {
  if (!asset || asset.kind !== 'image') throw new AssetError('asset_not_image', 409);
  if (asset.consent === 'missing') throw new AssetError('consent_missing', 409);
  if (!CONSENTS.includes(asset.consent) || !SOURCES.includes(asset.source)) throw new AssetError('asset_invalid', 409);
  if (asset.allowedTemplates && !asset.allowedTemplates.includes(templateId)) throw new AssetError('asset_not_allowed_for_template', 409);
}

module.exports = { createAssets, assertUsable, sniffImage, AssetError, SOURCES, CONSENTS, MAX_BYTES, MAX_TOTAL_BYTES };
