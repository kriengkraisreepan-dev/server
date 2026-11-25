'use strict';

// Shop info + FAQ that the owner edits in the Admin web. The AI reads these through tools
// (get_shop_info, search_faq) and never invents what is not here (S-3.1).
const ids = require('../ids');

/** Keys the owner can set. Anything else is rejected. */
const SHOP_INFO_KEYS = Object.freeze({
  hours_text: 'เวลาเปิด-ปิด (ข้อความ)',
  address: 'ที่อยู่',
  directions: 'การเดินทาง / ที่จอดรถ',
  contact: 'ช่องทางติดต่อพนักงาน (เช่น เบอร์ร้าน)',
  note: 'หมายเหตุอื่น ๆ',
});
const MAX_INFO_LEN = 1000;
const MAX_Q = 300;
const MAX_A = 1500;
const MAX_KW = 300;

class KnowledgeError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function clean(s, max) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\r\n/g, '\n').trim();
  return t.length <= max ? t : null;
}

/** Lower-case, strip spaces and punctuation, so "ที่ จอดรถ?" matches "ที่จอดรถ". */
function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s.,!?'"“”‘’()\-_/\\:;]+/g, '');
}

function createKnowledge({ db, audit, clock }) {
  return {
    SHOP_INFO_KEYS,

    async getShopInfo() {
      const { rows } = await db.query('SELECT key, value, updated_at FROM shop_info');
      const out = {};
      for (const r of rows) if (SHOP_INFO_KEYS[r.key]) out[r.key] = r.value;
      return out;
    },

    /** Replace the given keys; an empty string removes a key. */
    async setShopInfo(patch, actor = 'owner') {
      if (!patch || typeof patch !== 'object') throw new KnowledgeError('bad_request');
      const entries = Object.entries(patch);
      for (const [k, v] of entries) {
        if (!SHOP_INFO_KEYS[k]) throw new KnowledgeError('unknown_key');
        if (clean(v, MAX_INFO_LEN) === null) throw new KnowledgeError('too_long');
      }
      await db.tx(async (t) => {
        for (const [k, v] of entries) {
          const value = clean(v, MAX_INFO_LEN);
          if (value === '') await t.query('DELETE FROM shop_info WHERE key = $1', [k]);
          else {
            await t.query(
              `INSERT INTO shop_info (key, value, updated_at) VALUES ($1, $2, $3)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
              [k, value, new Date(clock.now())],
            );
          }
        }
        await audit.record({ actor, action: 'shop_info.updated', detail: { keys: entries.map(([k]) => k) } }, t);
      });
      return this.getShopInfo();
    },

    async listFaq() {
      const { rows } = await db.query('SELECT id, question, answer, keywords, enabled, updated_at FROM faq ORDER BY updated_at DESC');
      return rows.map((r) => ({ id: r.id, question: r.question, answer: r.answer, keywords: r.keywords, enabled: r.enabled, updatedAt: new Date(r.updated_at).toISOString() }));
    },

    async upsertFaq({ id, question, answer, keywords = '', enabled = true }, actor = 'owner') {
      const q = clean(question, MAX_Q);
      const a = clean(answer, MAX_A);
      const kw = clean(keywords, MAX_KW);
      if (!q || !a || kw === null || typeof enabled !== 'boolean') throw new KnowledgeError('bad_request');
      const faqId = id || `faq_${ids.ulid(clock.now())}`;
      const { rows } = await db.query(
        `INSERT INTO faq (id, question, answer, keywords, enabled, updated_at) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET question = EXCLUDED.question, answer = EXCLUDED.answer,
           keywords = EXCLUDED.keywords, enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at
         RETURNING id`,
        [faqId, q, a, kw, enabled, new Date(clock.now())],
      );
      await audit.record({ actor, action: id ? 'faq.updated' : 'faq.created', target: rows[0].id });
      return rows[0].id;
    },

    async deleteFaq(id, actor = 'owner') {
      const { rows } = await db.query('DELETE FROM faq WHERE id = $1 RETURNING id', [id]);
      if (rows.length) await audit.record({ actor, action: 'faq.deleted', target: id });
      return rows.length === 1;
    },

    /**
     * Simple keyword search, good enough for a shop-sized FAQ (tens of entries).
     * Score = how many of the entry's keywords / question words appear in the query.
     */
    async searchFaq(query, limit = 3) {
      const q = norm(query);
      if (!q) return [];
      const { rows } = await db.query('SELECT id, question, answer, keywords FROM faq WHERE enabled = true');
      const scored = [];
      for (const r of rows) {
        const terms = [r.question, ...String(r.keywords).split(/[,\n]/)].map(norm).filter((x) => x.length >= 2);
        let score = 0;
        for (const term of terms) {
          if (q.includes(term) || term.includes(q)) score += 2;
        }
        // Partial overlap on keywords written with spaces ("ที่จอด รถ").
        for (const word of String(r.keywords).split(/[\s,\n]+/).map(norm).filter((x) => x.length >= 2)) {
          if (q.includes(word)) score += 1;
        }
        if (score > 0) scored.push({ score, id: r.id, question: r.question, answer: r.answer });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).map(({ id, question, answer }) => ({ id, question, answer }));
    },
  };
}

module.exports = { createKnowledge, KnowledgeError, SHOP_INFO_KEYS, norm };
