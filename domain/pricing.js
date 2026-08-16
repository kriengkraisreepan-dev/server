const { requireNonNegativeSatang } = require("./money");
const UNITS = new Set(["HOUR", "MINUTE"]), ROUNDING = new Set(["NONE", "UP_TO_BAHT", "NEAREST_BAHT"]);
function normalizePricingProfile(profile) {
  if (!profile || typeof profile !== "object") throw new Error("Pricing profile is required");
  const normalized = { id: String(profile.id || "default"), name: String(profile.name || "Default"), unit: profile.unit || "HOUR", rateSatang: profile.rateSatang, minimumChargeSatang: profile.minimumChargeSatang ?? 0, roundingRule: profile.roundingRule || "NONE", weekdayRules: profile.weekdayRules || [], timeRules: profile.timeRules || [] };
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
  return Object.freeze({ ...normalized, rateSatang: requireNonNegativeSatang(Number(rule.rateSatang), "rule rateSatang"), appliedRuleId: rule.id || null });
}
module.exports = { normalizePricingProfile, calculateSessionCharge, calculateSessionPreview, snapshotPricing, applyRounding, resolveEffectiveProfile };
