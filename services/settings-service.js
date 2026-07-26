const { bahtToSatang, satangToBaht, requireNonNegativeSatang } = require("../domain/money");
const { normalizePricingProfile } = require("../domain/pricing");
const DEFAULTS = Object.freeze({ timeZone: "Asia/Bangkok", currency: "THB", dateTimeFormat: "th-TH", roundingRule: "UP_TO_BAHT", backupIntervalHours: 24, esp32: { enabled: false, baseUrl: "" }, security: { timeoutMinutes:480, warningMinutes:5, maxLoginAttempts:5, lockDurationMinutes:15 }, defaultPricingProfileId: "default" });
function normalizeSettings(current) {
  const hourlyRateSatang = current.hourlyRateSatang ?? bahtToSatang(current.hourlyRate ?? 0);
  const minimumChargeSatang = current.minimumChargeSatang ?? bahtToSatang(current.minimumCharge ?? 0);
  const pricingProfiles = current.pricingProfiles?.length ? current.pricingProfiles.map(normalizePricingProfile) : [normalizePricingProfile({ id: "default", name: "Default", unit: "HOUR", rateSatang: hourlyRateSatang, minimumChargeSatang, roundingRule: current.roundingRule || DEFAULTS.roundingRule })];
  return { ...DEFAULTS, ...current, roundingRule: "UP_TO_BAHT", hourlyRateSatang, minimumChargeSatang, hourlyRate: Number(satangToBaht(hourlyRateSatang)), minimumCharge: Number(satangToBaht(minimumChargeSatang)), pricingProfiles: pricingProfiles.map(profile => ({ ...profile, roundingRule: "UP_TO_BAHT" })), esp32: { ...DEFAULTS.esp32, ...(current.esp32 || {}) }, security: { ...DEFAULTS.security, ...(current.security || {}) } };
}
class SettingsService {
  constructor(repository) { this.repository = repository; }
  getSettings() { return normalizeSettings(this.repository.get()); }
  updateSettings(changes) {
    const current = this.getSettings(), next = { ...current, ...changes, esp32: { ...current.esp32, ...(changes.esp32 || {}) } };
    if (changes.hourlyRate !== undefined) next.hourlyRateSatang = bahtToSatang(changes.hourlyRate);
    if (changes.minimumCharge !== undefined) next.minimumChargeSatang = bahtToSatang(changes.minimumCharge);
    if (changes.hourlyRateSatang !== undefined) next.hourlyRateSatang = requireNonNegativeSatang(changes.hourlyRateSatang, "hourlyRateSatang");
    if (changes.minimumChargeSatang !== undefined) next.minimumChargeSatang = requireNonNegativeSatang(changes.minimumChargeSatang, "minimumChargeSatang");
    if (!Number.isInteger(next.tableCount) || next.tableCount < 1) throw new Error("tableCount must be a positive integer");
    if (next.timeZone !== "Asia/Bangkok") throw new Error("Only Asia/Bangkok is supported in Sprint 1");
    if (next.currency !== "THB") throw new Error("Only THB is supported in Sprint 1");
    if (!Number.isInteger(next.backupIntervalHours) || next.backupIntervalHours < 1) throw new Error("backupIntervalHours must be a positive integer");
    if (!changes.pricingProfiles && (changes.hourlyRate !== undefined || changes.minimumCharge !== undefined || changes.hourlyRateSatang !== undefined || changes.minimumChargeSatang !== undefined)) next.pricingProfiles = next.pricingProfiles.map(profile => profile.id === next.defaultPricingProfileId ? { ...profile, rateSatang: next.hourlyRateSatang, minimumChargeSatang: next.minimumChargeSatang, roundingRule: next.roundingRule } : profile);
    next.roundingRule = "UP_TO_BAHT";
    next.pricingProfiles = (next.pricingProfiles || []).map(profile => normalizePricingProfile({ ...profile, roundingRule: "UP_TO_BAHT" })); if (!next.pricingProfiles.some(profile => profile.id === next.defaultPricingProfileId)) throw new Error("defaultPricingProfileId must exist in pricingProfiles");
    next.hourlyRate = Number(satangToBaht(next.hourlyRateSatang)); next.minimumCharge = Number(satangToBaht(next.minimumChargeSatang));
    return this.repository.replace(next);
  }
}
module.exports = { SettingsService, normalizeSettings, DEFAULTS };
