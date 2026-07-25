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
function snapshotPricing(profile) { return { ...normalizePricingProfile(profile) }; }
module.exports = { normalizePricingProfile, calculateSessionCharge, snapshotPricing, applyRounding };
