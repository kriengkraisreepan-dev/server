// Table-time loyalty points.
//
// The shop charges more than one rate for the same hour of table time — ซ้อมเดี่ยว ฿80, Happy Hour
// ฿100, ปกติ ฿120 — so a single "5 points per hour" rule hands the cheapest hour the same reward as
// the dearest one. Points now follow the rate that was actually charged: every rate (the profile's
// base, each Happy Hour rule, and the practice rate) can name its own pointsPerInterval, and any
// that does not falls back to the shop-wide setting, which is exactly the old behaviour.
//
// The unit stayed the COMPLETED interval (default 60 minutes, FLOOR) — an hour half-played still
// earns nothing, as it always has. What changed is only which rate that completed hour is paid at.
// A session that ran across a rate change is walked hour by hour and each hour is awarded at the
// rate that covered most of it; nothing is pro-rated, because a customer who is told "5 points an
// hour" and plays two hours must be able to count on getting 10, not 9.67 rounded somewhere.

const DEFAULT_INTERVAL_MINUTES = 60, DEFAULT_POINTS_PER_INTERVAL = 5;

// Groups the awarded intervals into the lines a receipt or a checkout preview can show, so a
// customer asking "why only 4 points?" gets an answer rather than a number.
function summarise(awards) {
  const lines = [];
  for (const award of awards) {
    const key = `${award.rateSatang}|${award.pointsPerInterval}|${award.ruleName}`;
    const existing = lines.find(line => line.key === key);
    if (existing) { existing.intervals += 1; existing.points += award.pointsPerInterval; continue; }
    lines.push({ key, rateSatang: award.rateSatang, ruleName: award.ruleName, pointsPerInterval: award.pointsPerInterval, intervals: 1, points: award.pointsPerInterval });
  }
  return lines.map(({ key, ...line }) => line);
}

function calculateTablePoints({ playSeconds = 0, segments = null, intervalMinutes = DEFAULT_INTERVAL_MINUTES, defaultPointsPerInterval = DEFAULT_POINTS_PER_INTERVAL } = {}) {
  const seconds = Math.max(0, Number(playSeconds) || 0);
  const interval = Math.max(1, Number(intervalMinutes) || DEFAULT_INTERVAL_MINUTES) * 60;
  const fallback = Math.max(0, Number(defaultPointsPerInterval ?? DEFAULT_POINTS_PER_INTERVAL) || 0);
  const completedIntervals = Math.floor(seconds / interval);
  const empty = { points: 0, completedIntervals, playSeconds: seconds, intervalMinutes: interval / 60, breakdown: [] };
  if (!completedIntervals) return empty;

  // No segments at all: a session opened before segmented billing shipped, or a walk-in bill. One
  // rate for the whole thing, the shop-wide points setting, exactly as before.
  const spans = [];
  let cursor = 0;
  for (const segment of segments || []) {
    const segmentSeconds = Math.max(0, Number(segment?.seconds) || 0);
    if (!segmentSeconds) continue;
    spans.push({ from: cursor, to: cursor + segmentSeconds, rateSatang: Number(segment.rateSatang) || 0, ruleName: segment.ruleName || "", pointsPerInterval: segment.pointsPerInterval ?? null });
    cursor += segmentSeconds;
  }
  if (!spans.length) return { ...empty, points: completedIntervals * fallback, breakdown: summarise(Array.from({ length: completedIntervals }, () => ({ rateSatang: null, ruleName: "", pointsPerInterval: fallback }))) };

  const awards = [];
  for (let index = 0; index < completedIntervals; index += 1) {
    const from = index * interval, to = from + interval;
    // The winner is the rate that covered most of this hour. An exact split — which is not rare, a
    // table opened at 19:30 against a Happy Hour that ends at 20:00 is exactly 30/30 — goes to the
    // rate that awards MORE, so the shop rounds in the customer's favour rather than by accident of
    // which stretch came first. An hour past the end of the segments (only possible when the two
    // totals disagree by rounding) falls to the last span.
    const pointsOf = span => span.pointsPerInterval ?? fallback;
    let best = spans[spans.length - 1], bestOverlap = 0;
    for (const span of spans) {
      const overlap = Math.min(to, span.to) - Math.max(from, span.from);
      if (overlap <= 0) continue;
      if (overlap > bestOverlap || (overlap === bestOverlap && pointsOf(span) > pointsOf(best))) { bestOverlap = overlap; best = span; }
    }
    awards.push({ rateSatang: best.rateSatang, ruleName: best.ruleName, pointsPerInterval: best.pointsPerInterval ?? fallback });
  }
  return { points: awards.reduce((sum, award) => sum + award.pointsPerInterval, 0), completedIntervals, playSeconds: seconds, intervalMinutes: interval / 60, breakdown: summarise(awards) };
}

module.exports = { calculateTablePoints, DEFAULT_INTERVAL_MINUTES, DEFAULT_POINTS_PER_INTERVAL };
