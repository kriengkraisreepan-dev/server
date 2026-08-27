const fs = require("fs");
const path = require("path");

// Append-only history, one file per calendar month: history/<name>-YYYY-MM.jsonl, one JSON record
// per line.
//
// Why this exists: everything used to live in store.json, and store.json is rewritten in full on
// every table open, relay toggle, POS line and payment. That makes the cost of a single click
// proportional to every bill the shop has ever taken, which is why a system that felt instant in
// its first week feels slow in its first month and would be unusable in its tenth year. Appending
// one line costs the same on day 7000 as on day 1, and a query only ever opens the months it
// actually covers.
//
// Records are never edited in place. A changed record (a bill that gets voided, an order that gets
// billed) is appended again to the month it was FIRST created in, and readers keep the last
// version of each id. That keeps writes O(1) without ever rewriting a month file.
const MONTH_FILE = /^(.+)-(\d{4})-(\d{2})\.jsonl$/;

function monthOf(value) {
  const iso = typeof value === "string" ? value : new Date(value).toISOString();
  const month = String(iso).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? month : null;
}

// Inclusive list of YYYY-MM between two month keys. Used to turn a date-range query into the exact
// set of files worth opening.
function monthsBetween(from, to) {
  if (!from || !to || from > to) return [];
  const months = [];
  let [year, month] = from.split("-").map(Number);
  const limit = to;
  for (let guard = 0; guard < 2400; guard += 1) {
    const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    months.push(key);
    if (key >= limit) break;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

class MonthlyArchive {
  // `timestampOf` decides which month a record belongs to. It must be the record's own creation
  // time, never "now" — an update appended months later has to land in the file its original went
  // into, or the last-version-wins read would miss it.
  // `durable` fsyncs each append. On for money (bills, payments); off for the operational audit
  // trail, where losing the last line to a power cut costs nothing worth an fsync per click.
  constructor({ directory, name, timestampOf = record => record.createdAt, idOf = record => record.id, durable = true }) {
    this.directory = directory;
    this.name = name;
    this.timestampOf = timestampOf;
    this.idOf = idOf;
    this.durable = durable;
    this.monthCache = null;          // sorted YYYY-MM list; invalidated when a new month appears
    this.readCache = new Map();      // YYYY-MM -> { records, size } for months already parsed
  }

  file(month) { return path.join(this.directory, `${this.name}-${month}.jsonl`); }

  monthFor(record) { return monthOf(this.timestampOf(record)); }

  // Sorted oldest-first. Cached, because a 20-year archive is a 240-entry directory listing and
  // callers ask for it on every history query.
  months() {
    if (this.monthCache) return this.monthCache;
    let entries = [];
    try { entries = fs.readdirSync(this.directory); } catch { entries = []; }
    this.monthCache = entries
      .map(file => MONTH_FILE.exec(file))
      .filter(match => match && match[1] === this.name)
      .map(match => `${match[2]}-${match[3]}`)
      .sort();
    return this.monthCache;
  }

  append(record) { this.appendMany([record]); }

  // Groups by month so a mixed batch (the boot-time sweep, a migration) costs one write per month
  // touched rather than one per record.
  appendMany(records) {
    const byMonth = new Map();
    for (const record of records) {
      const month = this.monthFor(record);
      if (!month) continue;
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month).push(`${JSON.stringify(record)}\n`);
    }
    if (!byMonth.size) return 0;
    fs.mkdirSync(this.directory, { recursive: true });
    let written = 0;
    for (const [month, lines] of byMonth) {
      const target = this.file(month);
      const existed = fs.existsSync(target);
      const descriptor = fs.openSync(target, "a", 0o600);
      try {
        fs.writeFileSync(descriptor, lines.join(""), "utf8");
        if (this.durable) fs.fsyncSync(descriptor);
      } finally { fs.closeSync(descriptor); }
      written += lines.length;
      if (!existed) this.monthCache = null;
      this.readCache.delete(month);
    }
    return written;
  }

  // One month, newest version of each id, in the order they were first written.
  // A torn final line (power cut mid-append) is skipped rather than failing the whole month:
  // losing the last audit entry must never make ten years of history unreadable.
  readMonth(month) {
    const cached = this.readCache.get(month);
    const target = this.file(month);
    let stat = null;
    try { stat = fs.statSync(target); } catch { return []; }
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.records;
    const byId = new Map();
    let corrupt = 0;
    for (const line of fs.readFileSync(target, "utf8").split("\n")) {
      if (!line) continue;
      let record;
      try { record = JSON.parse(line); } catch { corrupt += 1; continue; }
      byId.set(String(this.idOf(record) ?? byId.size), record);
    }
    const records = [...byId.values()];
    this.readCache.set(month, { records, size: stat.size, mtimeMs: stat.mtimeMs, corrupt });
    // Only the newest month can be actively appended to; keep the parse cache small.
    if (this.readCache.size > 6) this.readCache.delete(this.readCache.keys().next().value);
    return records;
  }

  // Every record in the given inclusive YYYY-MM window, oldest month first. `null` bounds mean
  // "as far as the archive goes", which callers should avoid on a hot path.
  read({ fromMonth = null, toMonth = null } = {}) {
    const available = this.months();
    const first = fromMonth || available[0];
    const last = toMonth || available[available.length - 1];
    if (!first || !last) return [];
    const wanted = new Set(monthsBetween(first, last));
    return available.filter(month => wanted.has(month)).flatMap(month => this.readMonth(month));
  }

  // Newest month first, stopping as soon as `visit` returns false. Lets a paginated history screen
  // read one or two month files instead of the whole archive.
  scanNewestFirst(visit, { fromMonth = null, toMonth = null, maxMonths = Infinity } = {}) {
    const available = this.months().slice().reverse();
    let opened = 0;
    for (const month of available) {
      if (fromMonth && month < fromMonth) break;
      if (toMonth && month > toMonth) continue;
      if (opened >= maxMonths) break;
      opened += 1;
      if (visit(this.readMonth(month), month) === false) return;
    }
  }

  // Whole-file deletes for retention windows: dropping six-month-old audit history costs one
  // unlink per month instead of rewriting anything.
  dropMonthsBefore(month) {
    if (!monthOf(`${month}-01`)) return [];
    const dropped = this.months().filter(candidate => candidate < month);
    for (const candidate of dropped) {
      try { fs.rmSync(this.file(candidate), { force: true }); } catch {}
      this.readCache.delete(candidate);
    }
    if (dropped.length) this.monthCache = null;
    return dropped;
  }
}

module.exports = { MonthlyArchive, monthOf, monthsBetween };
