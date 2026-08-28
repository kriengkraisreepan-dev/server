const fs = require("fs");
const path = require("path");
const { MonthlyArchive, monthOf, monthsBetween } = require("./monthly-archive");

// Which collections are history rather than working state, and when a record stops changing.
//
// Everything here used to live inside store.json, which is rewritten in full on every click. These
// are the collections that grow without limit — a shop taking 30 bills a day accumulates ~220,000
// of them over twenty years — so keeping them there makes every relay toggle slower than the last.
// They move into month files instead, and store.json keeps only what is still in play.
//
// What deliberately stays in store.json, and why: `products`, `productCategories`, `tables`,
// `users` and `settings` are the shop's configuration — small, fixed, and read on every request.
// `members` grows with the customer list rather than with transactions. `memberPointTransactions`
// and `couponRedemptions` are transactional and do grow, but both are read as a complete per-member
// history (point expiry sums a member's whole ledger; coupon limits are "once per member"), so
// archiving them needs those calculations reworked first — they add roughly 5 MB over twenty
// years, against the 42 MB that stockMovements alone would have added.
//
// "Terminal" means the record has reached a state it will not normally leave. Terminal records are
// not archived immediately: they stay in store.json for HOT_DAYS so that same-day work — today's
// dashboard, a mistaken bill voided an hour later, a session that ran past midnight — never has to
// touch a file. The window is deliberately wider than one day because the shop trades past
// midnight and the business day rolls at 06:00.
const HOT_DAYS = 3;
// Safety valve for records that never reach a terminal state because a person walked away from
// them: a bill left "awaiting payment" or an order confirmed onto a tab that was never billed.
// The shop's own data showed roughly eight of each accumulating per month, and every one of them
// would otherwise sit in the file rewritten on every click for the lifetime of the installation.
// Six months is far beyond any point at which such a record is still being worked on, and it stays
// fully searchable in its month file afterwards.
const STALE_DAYS = 180;
const DAY_MS = 86400000;
// Bumped whenever a collection is added below, so the one-time migration runs again and sweeps the
// newcomer out of an already-migrated store.
const HISTORY_SCHEMA_VERSION = 2;

const COLLECTIONS = Object.freeze({
  bills: {
    key: "bills", archiveName: "bills", durable: true, stale: true,
    timestampOf: record => record.createdAt,
    isTerminal: record => record.status === "paid" || record.status === "void"
  },
  // Immutable ledger of every stock change, one or more rows per POS sale. Originally left in
  // store.json as "grows slowly" — the shop's first month proved that wrong at ~17 rows a day,
  // which is 124,000 rows and 42 MB of per-click rewriting over twenty years. It is written far
  // more often than it is read, which is exactly what an append-only month file is for.
  stockMovements: {
    key: "stockMovements", archiveName: "stock-movements", durable: true,
    timestampOf: record => record.createdAt,
    isTerminal: () => true
  },
  payments: {
    key: "payments", archiveName: "payments", durable: true,
    timestampOf: record => record.createdAt,
    isTerminal: record => ["paid", "cancelled", "failed", "refunded"].includes(record.status)
  },
  posOrders: {
    key: "posOrders", archiveName: "pos-orders", durable: true, stale: true,
    timestampOf: record => record.createdAt,
    isTerminal: record => record.status === "CANCELLED" || (record.status === "CONFIRMED" && record.billingStatus === "BILLED")
  },
  tableSessions: {
    key: "tableSessions", archiveName: "table-sessions", durable: true,
    timestampOf: record => record.openedAt || record.createdAt,
    isTerminal: record => record.state === "CLOSED" || record.state === "CANCELLED" || record.state === "COMPLETED"
  },
  // The audit trail is never updated after the fact and never needs to be hot: it is written once
  // and only ever read by the Audit screen. It goes straight to its month file, which is why
  // appending one costs the same in year ten as on day one.
  auditLogs: {
    key: "auditLogs", archiveName: "audit", durable: false, alwaysCold: true,
    timestampOf: record => record.occurredAt || record.createdAt,
    isTerminal: () => true
  }
});

class HistoryStore {
  constructor({ directory, getStore, save, log = () => {} }) {
    this.directory = directory;
    this.getStore = getStore;
    this.save = save;
    this.log = log;
    this.archives = {};
    for (const definition of Object.values(COLLECTIONS)) {
      this.archives[definition.key] = new MonthlyArchive({
        directory, name: definition.archiveName, durable: definition.durable,
        timestampOf: definition.timestampOf
      });
    }
  }

  archive(key) { return this.archives[key]; }

  hot(key) { const store = this.getStore(); if (!Array.isArray(store[key])) store[key] = []; return store[key]; }

  // The oldest wall-clock day that is still considered "in play".
  hotCutoffIso(now = new Date()) { return new Date(now.getTime() - HOT_DAYS * DAY_MS).toISOString(); }
  staleCutoffIso(now = new Date()) { return new Date(now.getTime() - STALE_DAYS * DAY_MS).toISOString(); }

  // A record leaves the working set when it is finished and past the hot window, or — for the
  // collections marked `stale` — when it is so old that nobody is coming back to finish it.
  // Table sessions are deliberately not marked stale: an open session drives what the table cards
  // show, and must stay where the running shop can see it however long it has been open.
  isArchivable(definition, record, now = new Date()) {
    const timestamp = String(definition.timestampOf(record) || "");
    if (!timestamp || !monthOf(timestamp)) return false;
    if (definition.alwaysCold) return true;
    if (definition.isTerminal(record)) return timestamp < this.hotCutoffIso(now);
    return Boolean(definition.stale) && timestamp < this.staleCutoffIso(now);
  }

  // Moves finished records out of store.json and into their month files. Run at boot and on a
  // timer; the caller persists the shrunken store afterwards. Returns how many of each moved.
  sweep(now = new Date()) {
    const moved = {};
    for (const definition of Object.values(COLLECTIONS)) {
      const records = this.hot(definition.key);
      if (!records.length) continue;
      const cold = [], stillHot = [];
      for (const record of records) (this.isArchivable(definition, record, now) ? cold : stillHot).push(record);
      if (!cold.length) continue;
      this.archives[definition.key].appendMany(cold);
      this.getStore()[definition.key] = stillHot;
      moved[definition.key] = cold.length;
    }
    return moved;
  }

  // ---- read-through helpers -------------------------------------------------------------------
  // Hot records are the recent ones, so every query is "the month files the range covers, plus
  // whatever has not been swept out of store.json yet", de-duplicated by id with the hot copy
  // winning (it is by definition the newer version).

  monthRange(fromIso, toIso) {
    const from = monthOf(fromIso) || null;
    const to = monthOf(toIso) || null;
    return { fromMonth: from, toMonth: to };
  }

  // Every record of `key` whose own timestamp falls in the inclusive YYYY-MM-DD range.
  inRange(key, fromDay, toDay) {
    const definition = COLLECTIONS[key];
    const { fromMonth, toMonth } = this.monthRange(fromDay, toDay);
    const archived = this.archives[key].read({ fromMonth, toMonth });
    const byId = new Map();
    for (const record of archived) byId.set(String(record.id), record);
    for (const record of this.hot(key)) byId.set(String(record.id), record);
    return [...byId.values()].filter(record => {
      const day = String(definition.timestampOf(record) || "").slice(0, 10);
      if (!day) return false;
      return (!fromDay || day >= fromDay) && (!toDay || day <= toDay);
    });
  }

  // Hot records plus the newest `months` month files. The default view for screens that show
  // "recent history" without the user having picked a date range.
  recent(key, months = 3) {
    const byId = new Map();
    this.archives[key].scanNewestFirst(records => { for (const record of records) if (!byId.has(String(record.id))) byId.set(String(record.id), record); }, { maxMonths: months });
    const result = [...byId.values()];
    for (const record of this.hot(key)) { const index = result.findIndex(item => String(item.id) === String(record.id)); if (index >= 0) result[index] = record; else result.push(record); }
    return result;
  }

  // Hot first, then month files newest-first. `hintIso` (the record's own timestamp, when the
  // caller already knows it) turns a scan into a single file read.
  findById(key, id, { hintIso = null, maxMonths = 36 } = {}) {
    const wanted = String(id);
    const hot = this.hot(key).find(record => String(record.id) === wanted);
    if (hot) return { record: hot, source: "hot" };
    const archive = this.archives[key];
    const hintMonth = hintIso ? monthOf(hintIso) : null;
    if (hintMonth) {
      const found = archive.readMonth(hintMonth).find(record => String(record.id) === wanted);
      if (found) return { record: found, source: "archive", month: hintMonth };
    }
    let found = null, foundMonth = null;
    archive.scanNewestFirst((records, month) => {
      if (month === hintMonth) return true;
      const match = records.find(record => String(record.id) === wanted);
      if (match) { found = match; foundMonth = month; return false; }
      return true;
    }, { maxMonths });
    return found ? { record: found, source: "archive", month: foundMonth } : { record: null, source: null };
  }

  // Writes an updated version of a record that has already been archived. The new version goes to
  // the month the record was created in, and readers keep the last version of each id — so this
  // stays a single append no matter how old the record is.
  updateArchived(key, record) { this.archives[key].append(record); return record; }

  // Cheap "is it even worth looking" test. A record created inside the hot window cannot have been
  // swept yet, so saving a brand-new bill must never pay for a read of the current month's file.
  mayBeArchived(key, record, now = new Date()) {
    const definition = COLLECTIONS[key];
    if (!definition) return false;
    const timestamp = String(definition.timestampOf(record) || "");
    // Deliberately looser than isArchivable(): this only has to be true for anything that COULD
    // already be in a month file, and a record's state may have changed since it was swept.
    return Boolean(timestamp) && (definition.alwaysCold || timestamp < this.hotCutoffIso(now));
  }

  isArchived(key, record) {
    const month = this.archives[key].monthFor(record);
    if (!month) return false;
    return this.archives[key].readMonth(month).some(item => String(item.id) === String(record.id));
  }

  // ---- one-time migration ---------------------------------------------------------------------
  // Existing installations have all of this history sitting in store.json. Move it out on the
  // first boot after the upgrade, in one pass, so the shop's very next click is already cheap.
  migrateLegacyStore(now = new Date()) {
    const store = this.getStore();
    if (Number(store.historySchemaVersion) >= HISTORY_SCHEMA_VERSION) return null;
    // The Audit screen's event filter is fed by a small registry kept alongside the working set
    // rather than derived from the trail. Seed it from the entries about to be archived, or the
    // dropdown would come up empty on an upgraded shop until every event type happened again.
    const eventTypes = new Set(Array.isArray(store.auditEventTypes) ? store.auditEventTypes : []);
    for (const entry of this.hot("auditLogs")) if (entry.event) eventTypes.add(entry.event);
    store.auditEventTypes = [...eventTypes].sort();
    const moved = this.sweep(now);
    store.historySchemaVersion = HISTORY_SCHEMA_VERSION;
    store.historyMigratedAt = now.toISOString();
    const total = Object.values(moved).reduce((sum, count) => sum + count, 0);
    this.log("INFO", "HISTORY_ARCHIVE_MIGRATED", { moved, total });
    return { moved, total };
  }

  // ---- maintenance ----------------------------------------------------------------------------
  // Retention for the audit trail: whole month files are unlinked, so trimming six-month-old
  // operational history costs one delete per month rather than rewriting anything.
  dropAuditMonthsBefore(month) { return this.archives.auditLogs.dropMonthsBefore(month); }

  // Month files are immutable once their month has closed, so keeping a mirror in sync is a
  // copy of whatever changed — normally just the current month — rather than a full re-export.
  mirrorTo(targetDirectory) {
    let sourceFiles = [];
    try { sourceFiles = fs.readdirSync(this.directory).filter(file => file.endsWith(".jsonl")); } catch { return 0; }
    if (!sourceFiles.length) return 0;
    fs.mkdirSync(targetDirectory, { recursive: true });
    let copied = 0;
    for (const file of sourceFiles) {
      const source = path.join(this.directory, file), target = path.join(targetDirectory, file);
      const sourceStat = fs.statSync(source);
      let targetStat = null;
      try { targetStat = fs.statSync(target); } catch {}
      if (targetStat && targetStat.size === sourceStat.size && targetStat.mtimeMs >= sourceStat.mtimeMs) continue;
      fs.copyFileSync(source, target);
      copied += 1;
    }
    // Retention has to reach the mirror too, or six-month-old audit months deleted from the live
    // archive would live on here forever — the opposite of what the retention window promises.
    // Guarded by the empty-source check above so a missing source directory can never wipe it.
    const live = new Set(sourceFiles);
    for (const file of fs.readdirSync(targetDirectory)) {
      if (!file.endsWith(".jsonl") || live.has(file)) continue;
      try { fs.rmSync(path.join(targetDirectory, file), { force: true }); } catch {}
    }
    return copied;
  }

  files() {
    try { return fs.readdirSync(this.directory).filter(file => file.endsWith(".jsonl")).map(file => ({ file, bytes: fs.statSync(path.join(this.directory, file)).size })); } catch { return []; }
  }
}

module.exports = { HistoryStore, COLLECTIONS, HOT_DAYS, STALE_DAYS, HISTORY_SCHEMA_VERSION, monthOf, monthsBetween };
