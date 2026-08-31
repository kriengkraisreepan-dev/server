const { requireNonNegativeSatang } = require("./money");
const UNITS = new Set(["HOUR", "MINUTE"]), ROUNDING = new Set(["NONE", "UP_TO_BAHT", "NEAREST_BAHT"]);
// Optional per-profile figures. `null` is a real value here and means "not set": a profile with no
// practice rate does not offer the ซ้อม button at all, and a rate with no pointsPerInterval falls
// back to the shop-wide loyalty setting rather than earning nothing.
function optionalSatang(value, label) { if (value === null || value === undefined || value === "") return null; return requireNonNegativeSatang(Number(value), label); }
function optionalPoints(value, label) { if (value === null || value === undefined || value === "") return null; const points = Number(value); if (!Number.isInteger(points) || points < 0) throw new Error(`${label} must be a non-negative integer`); return points; }
function normalizePricingProfile(profile) {
  if (!profile || typeof profile !== "object") throw new Error("Pricing profile is required");
  // pricingMode is carried through normalisation on purpose: it is how a session snapshot taken
  // after segmented billing shipped is told apart from one taken before it. Absent = the old
  // single-rate behaviour, which sessions already open at upgrade time must keep.
  const normalized = { id: String(profile.id || "default"), name: String(profile.name || "Default"), unit: profile.unit || "HOUR", rateSatang: profile.rateSatang, minimumChargeSatang: profile.minimumChargeSatang ?? 0, roundingRule: profile.roundingRule || "NONE", weekdayRules: profile.weekdayRules || [], timeRules: profile.timeRules || [], pricingMode: profile.pricingMode || "FLAT", practiceRateSatang: optionalSatang(profile.practiceRateSatang, "practiceRateSatang"), pointsPerInterval: optionalPoints(profile.pointsPerInterval, "pointsPerInterval"), practicePointsPerInterval: optionalPoints(profile.practicePointsPerInterval, "practicePointsPerInterval"), practice: Boolean(profile.practice) };
  if (!UNITS.has(normalized.unit)) throw new Error("Unsupported pricing unit");
  if (!ROUNDING.has(normalized.roundingRule)) throw new Error("Unsupported rounding rule");
  requireNonNegativeSatang(normalized.rateSatang, "rateSatang"); requireNonNegativeSatang(normalized.minimumChargeSatang, "minimumChargeSatang");
  if (!Array.isArray(normalized.weekdayRules) || !Array.isArray(normalized.timeRules)) throw new Error("Pricing rules must be arrays");
  return Object.freeze(normalized);
}
function applyRounding(satang, rule) { if (rule === "UP_TO_BAHT") return Math.ceil(satang / 100) * 100; if (rule === "NEAREST_BAHT") return Math.round(satang / 100) * 100; return satang; }
function calculateSessionCharge(pricingSnapshot, billableSeconds) {
  const profile = normalizePricingProfile(pricingSnapshot); if (!Number.isSafeInteger(billableSeconds) || billableSeconds < 0) throw new Error("billableSeconds must be a non-negative integer");
  const denominator = profile.unit === "HOUR" ? 3600 : 60;
  const rawSatang = Math.ceil((profile.rateSatang * billableSeconds) / denominator);
  return applyRounding(Math.max(profile.minimumChargeSatang, rawSatang), profile.roundingRule);
}
function calculateSessionPreview(pricingSnapshot, billableSeconds) {
  const profile = normalizePricingProfile(pricingSnapshot); if (!Number.isSafeInteger(billableSeconds) || billableSeconds < 0) throw new Error("billableSeconds must be a non-negative integer");
  const denominator = profile.unit === "HOUR" ? 3600 : 60;
  return Math.max(profile.minimumChargeSatang, Math.ceil((profile.rateSatang * billableSeconds) / denominator));
}
function snapshotPricing(profile) { return { ...normalizePricingProfile(profile) }; }

// Happy Hour rate rules — each rule in profile.timeRules is {weekdays:number[] (0=Sun..6=Sat, empty
// = every day), startTime:"HH:MM", endTime:"HH:MM" (both empty = all day), rateSatang}. The FIRST
// matching rule (in array order) wins; no match falls back to the profile's base rateSatang. Time
// ranges that wrap past midnight (e.g. 22:00-02:00, for shops open late) are supported.
function parseTimeToMinutes(value) { if (!value) return 0; const [hours, minutes] = String(value).split(":").map(Number); return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0); }
function minutesWithinRange(minutes, startMinutes, endMinutes) {
  if (startMinutes === endMinutes) return true; // both empty (or identical) = matches all day
  if (startMinutes < endMinutes) return minutes >= startMinutes && minutes < endMinutes;
  return minutes >= startMinutes || minutes < endMinutes; // overnight span
}
function ruleMatches(rule, weekday, minutes) {
  const weekdayMatch = !Array.isArray(rule.weekdays) || !rule.weekdays.length || rule.weekdays.includes(weekday);
  return weekdayMatch && minutesWithinRange(minutes, parseTimeToMinutes(rule.startTime), parseTimeToMinutes(rule.endTime));
}
// Resolves the effective profile (with rateSatang possibly overridden by a matching Happy Hour
// rule) as of `at` — always call this once, at table-start time, and snapshot the result on the
// session; the resolved rate must never be recalculated mid-session even if the rule window
// starts/ends while the table is playing (see pricingSnapshot on TableSession).
function resolveEffectiveProfile(profile, at = new Date()) {
  const normalized = normalizePricingProfile(profile);
  const thaiLocal = new Date(at.getTime() + 7 * 60 * 60 * 1000); // shop is always Asia/Bangkok (UTC+7)
  const weekday = thaiLocal.getUTCDay(), minutes = thaiLocal.getUTCHours() * 60 + thaiLocal.getUTCMinutes();
  const rule = (normalized.timeRules || []).find(candidate => ruleMatches(candidate, weekday, minutes));
  if (!rule) return normalized;
  return Object.freeze({ ...normalized, rateSatang: requireNonNegativeSatang(Number(rule.rateSatang), "rule rateSatang"), pointsPerInterval: optionalPoints(rule.pointsPerInterval, "rule pointsPerInterval") ?? normalized.pointsPerInterval, appliedRuleId: rule.id || null });
}
// ---------------------------------------------------------------------------
// Segmented (time-of-day) billing
//
// The old model resolved one rate at table-open and charged it for the whole session. That let a
// customer open a table five minutes before Happy Hour ended and play all night at the discount,
// and equally denied the discount to someone already playing when it started. Segmented billing
// walks the session's actual clock instead and charges each stretch at the rate that was in force
// during it.
//
// The snapshot on the session must therefore keep the profile's BASE rate and its rules — not a
// rate already overridden by whichever rule matched at open time, which is what
// resolveEffectiveProfile returns and what the flat model stored. snapshotSegmentedPricing is the
// one that keeps them, and it stamps pricingMode so old sessions keep the old maths.
function snapshotSegmentedPricing(profile) { return { ...normalizePricingProfile({ ...profile, pricingMode: "SEGMENTED" }) }; }
function isSegmented(snapshot) { return snapshot?.pricingMode === "SEGMENTED"; }

const MINUTE_MS = 60000;
function thaiParts(instant) { const local = new Date(instant.getTime() + 7 * 60 * 60 * 1000); return { weekday: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() }; }
function ruleAt(profile, instant) {
  const { weekday, minutes } = thaiParts(instant);
  return (profile.timeRules || []).find(candidate => ruleMatches(candidate, weekday, minutes)) || null;
}
function rateAt(profile, instant) { const rule = ruleAt(profile, instant); return rule ? { rateSatang: requireNonNegativeSatang(Number(rule.rateSatang), "rule rateSatang"), ruleId: rule.id || null, ruleName: rule.name || "", pointsPerInterval: optionalPoints(rule.pointsPerInterval, "rule pointsPerInterval") } : { rateSatang: profile.rateSatang, ruleId: null, ruleName: "", pointsPerInterval: profile.pointsPerInterval }; }

// Splits [openedAt, endsAt] wherever the applicable rate changes. Rule boundaries are HH:MM, so a
// minute-by-minute scan finds every one of them exactly; the session's own start and end keep their
// real second. Paused stretches are removed from the segment they actually fall in when the session
// recorded them (pauseIntervals), and spread across segments in proportion when it did not — which
// is only possible for sessions opened before pause intervals were recorded.
function calculateRateSegments(snapshot, { openedAt, endsAt, pauseIntervals = [], pausedSeconds = 0 } = {}) {
  const profile = normalizePricingProfile(snapshot);
  const start = new Date(openedAt), end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("Session start and end are required");
  if (end < start) throw new Error("Session end cannot be before its start");
  const boundaries = [start];
  let current = rateAt(profile, start);
  for (let tick = Math.ceil(start.getTime() / MINUTE_MS) * MINUTE_MS; tick < end.getTime(); tick += MINUTE_MS) {
    const at = new Date(tick), next = rateAt(profile, at);
    // Two rules can charge the same baht and still award different points, so the points rate is
    // part of what makes a boundary — otherwise those hours would all be awarded at the first one's.
    if (next.rateSatang !== current.rateSatang || next.ruleId !== current.ruleId || next.pointsPerInterval !== current.pointsPerInterval) { boundaries.push(at); current = next; }
  }
  boundaries.push(end);
  const spans = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const from = boundaries[index], to = boundaries[index + 1];
    const elapsed = Math.max(0, Math.floor((to - from) / 1000));
    if (!elapsed) continue;
    spans.push({ from, to, elapsedSeconds: elapsed, ...rateAt(profile, from) });
  }
  const recorded = (pauseIntervals || []).map(interval => ({ from: new Date(interval.from), to: new Date(interval.to) })).filter(interval => !Number.isNaN(interval.from.getTime()) && !Number.isNaN(interval.to.getTime()) && interval.to > interval.from);
  const totalElapsed = spans.reduce((sum, span) => sum + span.elapsedSeconds, 0);
  const denominator = profile.unit === "HOUR" ? 3600 : 60;
  const segments = spans.map(span => {
    const paused = recorded.length
      ? recorded.reduce((sum, interval) => sum + Math.max(0, Math.floor((Math.min(span.to, interval.to) - Math.max(span.from, interval.from)) / 1000)), 0)
      : (totalElapsed ? Math.round(pausedSeconds * (span.elapsedSeconds / totalElapsed)) : 0);
    const seconds = Math.max(0, span.elapsedSeconds - paused);
    return { from: span.from.toISOString(), to: span.to.toISOString(), rateSatang: span.rateSatang, ruleId: span.ruleId, ruleName: span.ruleName, pointsPerInterval: span.pointsPerInterval ?? null, elapsedSeconds: span.elapsedSeconds, pausedSeconds: paused, seconds, satang: Math.ceil((span.rateSatang * seconds) / denominator) };
  }).filter(segment => segment.seconds > 0);
  return segments;
}
// The minimum charge and the rounding rule apply once to the whole session, not per segment —
// otherwise a two-segment session would pay the minimum twice. Each segment keeps its own already
// rounded-up satang so the printed lines sum exactly to the pre-minimum subtotal.
function calculateSegmentedCharge(snapshot, session) {
  const profile = normalizePricingProfile(snapshot);
  const segments = calculateRateSegments(snapshot, session);
  const subtotalSatang = segments.reduce((sum, segment) => sum + segment.satang, 0);
  const billableSeconds = segments.reduce((sum, segment) => sum + segment.seconds, 0);
  // previewSatang mirrors calculateSessionPreview: the minimum charge applies to a running preview
  // (a table that just opened already owes it) but the rounding rule does not, because rounding is
  // a property of the final bill and would make the live total jitter as seconds tick past.
  const previewSatang = Math.max(profile.minimumChargeSatang, subtotalSatang);
  return { segments, billableSeconds, subtotalSatang, previewSatang, chargeSatang: applyRounding(previewSatang, profile.roundingRule) };
}
// ---------------------------------------------------------------------------
// ซ้อมเดี่ยว — one person practising alone, charged a flat lower rate.
//
// It is a DERIVED profile rather than another entry in the picker: the practice rate belongs to the
// table's own profile (a VIP room can practise at a different price from the main floor), and the
// customer chooses it by pressing a different button, not by the cashier remembering which profile
// means what. Happy Hour is stripped deliberately — the practice rate is already the cheapest thing
// on the board, and a rule that undercut it would be a mistake rather than a discount. What comes
// back is an ordinary single-rate profile, so every segment/charge path above still works unchanged.
function practicePricingProfile(profile) {
  const normalized = normalizePricingProfile(profile);
  if (normalized.practiceRateSatang === null) { const error = new Error("This pricing profile has no practice rate configured"); error.code = "PRACTICE_RATE_NOT_CONFIGURED"; throw error; }
  return normalizePricingProfile({ ...normalized, rateSatang: normalized.practiceRateSatang, timeRules: [], weekdayRules: [], pointsPerInterval: normalized.practicePointsPerInterval, practice: true });
}
function isPractice(snapshot) { return Boolean(snapshot?.practice); }
module.exports = { normalizePricingProfile, practicePricingProfile, isPractice, calculateSessionCharge, calculateSessionPreview, snapshotPricing, applyRounding, resolveEffectiveProfile, snapshotSegmentedPricing, isSegmented, calculateRateSegments, calculateSegmentedCharge };
