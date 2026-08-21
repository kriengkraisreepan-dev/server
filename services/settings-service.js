const { bahtToSatang, satangToBaht, requireNonNegativeSatang } = require("../domain/money");
const { normalizePricingProfile } = require("../domain/pricing");
const DEFAULTS = Object.freeze({ timeZone: "Asia/Bangkok", currency: "THB", dateTimeFormat: "th-TH", roundingRule: "UP_TO_BAHT", businessDayStartHour: 6, backupIntervalHours: 24, backupExternalPath: "", esp32: { enabled: false, baseUrl: "" }, hardware: { setupWizardEnabled: true, discoveryEnabled: true, wifiProvisioningEnabled: true, setupApEnabled: true, setupButtonEnabled: false, automaticWifiRecoveryEnabled: false }, security: { timeoutMinutes:480, warningMinutes:5, maxLoginAttempts:5, lockDurationMinutes:15 }, rewards: { rewardPointValue: 1, rewardMinimumPoints: 100, allowPartialRedeem: true, allowRedeemTable: true, allowRedeemWalkIn: false }, loyalty: { tablePointsPerHour: 5, tablePointIntervalMinutes: 60, tablePointRounding: "FLOOR", pointExpiryMonths: 0 }, reservation: { defaultDepositAmount: 100, minimumDepositAmount: 100, depositRequired: true, autoAssignTable: true, autoLightOn: true, allowLightBeforeCheckIn: true, checkInGraceMinutes: 60, autoApplyDeposit: true, allowManualDepositRemoval: false, alertEnabled: true, alertSoundEnabled: true, alertSoundVolume: 80, alertRepeatMinutes: 1, deferMinutes: 20, tableFreeAlertMinutes: 5, deferredPriorityEnabled: true, autoForfeitNoShowDeposit: true }, defaultPricingProfileId: "default" });
function normalizeSettings(current) {
  const hourlyRateSatang = current.hourlyRateSatang ?? bahtToSatang(current.hourlyRate ?? 0);
  const minimumChargeSatang = current.minimumChargeSatang ?? bahtToSatang(current.minimumCharge ?? 0);
  const pricingProfiles = current.pricingProfiles?.length ? current.pricingProfiles.map(normalizePricingProfile) : [normalizePricingProfile({ id: "default", name: "Default", unit: "HOUR", rateSatang: hourlyRateSatang, minimumChargeSatang, roundingRule: current.roundingRule || DEFAULTS.roundingRule })];
  return { ...DEFAULTS, ...current, roundingRule: "UP_TO_BAHT", hourlyRateSatang, minimumChargeSatang, hourlyRate: Number(satangToBaht(hourlyRateSatang)), minimumCharge: Number(satangToBaht(minimumChargeSatang)), pricingProfiles: pricingProfiles.map(profile => ({ ...profile, roundingRule: "UP_TO_BAHT" })), esp32: { ...DEFAULTS.esp32, ...(current.esp32 || {}) }, hardware: { ...DEFAULTS.hardware, ...(current.hardware || {}) }, security: { ...DEFAULTS.security, ...(current.security || {}) }, rewards: { ...DEFAULTS.rewards, ...(current.rewards || {}), allowRedeemWalkIn:false }, loyalty: { ...DEFAULTS.loyalty, ...(current.loyalty || {}), tablePointRounding:"FLOOR" }, reservation: { ...DEFAULTS.reservation, ...(current.reservation || {}) } };
}
class SettingsService {
  constructor(repository) { this.repository = repository; }
  getSettings() { return normalizeSettings(this.repository.get()); }
  updateSettings(changes) {
    const current = this.getSettings(), next = { ...current, ...changes, esp32: { ...current.esp32, ...(changes.esp32 || {}) }, hardware: { ...current.hardware, ...(changes.hardware || {}) }, rewards: { ...current.rewards, ...(changes.rewards || {}), allowRedeemWalkIn:false }, loyalty: { ...current.loyalty, ...(changes.loyalty || {}), tablePointRounding:"FLOOR" }, reservation: { ...current.reservation, ...(changes.reservation || {}) } };
    if (changes.hourlyRate !== undefined) next.hourlyRateSatang = bahtToSatang(changes.hourlyRate);
    if (changes.minimumCharge !== undefined) next.minimumChargeSatang = bahtToSatang(changes.minimumCharge);
    if (changes.hourlyRateSatang !== undefined) next.hourlyRateSatang = requireNonNegativeSatang(changes.hourlyRateSatang, "hourlyRateSatang");
    if (changes.minimumChargeSatang !== undefined) next.minimumChargeSatang = requireNonNegativeSatang(changes.minimumChargeSatang, "minimumChargeSatang");
    if (!Number.isInteger(next.tableCount) || next.tableCount < 1) throw new Error("tableCount must be a positive integer");
    if (next.timeZone !== "Asia/Bangkok") throw new Error("Only Asia/Bangkok is supported in Sprint 1");
    if (next.currency !== "THB") throw new Error("Only THB is supported in Sprint 1");
    // The hour a business day rolls over. A snooker club trades past midnight, so the calendar day
    // splits one night's takings across two reports; the owner reconciles in the morning and wants
    // the whole night in one number. 0 restores plain calendar days.
    next.businessDayStartHour = Number(next.businessDayStartHour ?? DEFAULTS.businessDayStartHour);
    if (!Number.isInteger(next.businessDayStartHour) || next.businessDayStartHour < 0 || next.businessDayStartHour > 23) throw new Error("businessDayStartHour must be an integer between 0 and 23");
    if (!Number.isInteger(next.backupIntervalHours) || next.backupIntervalHours < 1) throw new Error("backupIntervalHours must be a positive integer");
    if (typeof next.backupExternalPath !== "string" || next.backupExternalPath.length > 260 || /[\r\n\0]/.test(next.backupExternalPath)) throw new Error("backupExternalPath must be a plain path string");
    if (typeof next.hardware.setupWizardEnabled !== "boolean") throw new Error("hardware.setupWizardEnabled must be boolean");
    if (typeof next.hardware.discoveryEnabled !== "boolean") throw new Error("hardware.discoveryEnabled must be boolean");
    if (typeof next.hardware.wifiProvisioningEnabled !== "boolean") throw new Error("hardware.wifiProvisioningEnabled must be boolean");
    if (typeof next.hardware.setupApEnabled !== "boolean") throw new Error("hardware.setupApEnabled must be boolean");
    if (typeof next.hardware.setupButtonEnabled !== "boolean") throw new Error("hardware.setupButtonEnabled must be boolean");
    if (typeof next.hardware.automaticWifiRecoveryEnabled !== "boolean") throw new Error("hardware.automaticWifiRecoveryEnabled must be boolean");
    if (!Number.isFinite(Number(next.rewards.rewardPointValue)) || Number(next.rewards.rewardPointValue) <= 0) throw new Error("rewardPointValue must be greater than zero");
    if (!Number.isInteger(Number(next.rewards.rewardMinimumPoints)) || Number(next.rewards.rewardMinimumPoints) < 1) throw new Error("rewardMinimumPoints must be a positive integer");
    ["allowPartialRedeem", "allowRedeemTable", "allowRedeemWalkIn"].forEach(key => { if (typeof next.rewards[key] !== "boolean") throw new Error(`${key} must be boolean`); });
    if (!Number.isInteger(Number(next.loyalty.tablePointsPerHour)) || Number(next.loyalty.tablePointsPerHour) < 0) throw new Error("tablePointsPerHour must be a non-negative integer");
    if (!Number.isInteger(Number(next.loyalty.tablePointIntervalMinutes)) || Number(next.loyalty.tablePointIntervalMinutes) < 1) throw new Error("tablePointIntervalMinutes must be a positive integer");
    if (!Number.isInteger(Number(next.loyalty.pointExpiryMonths)) || Number(next.loyalty.pointExpiryMonths) < 0) throw new Error("pointExpiryMonths must be a non-negative integer (0 = never expires)");
    ["defaultDepositAmount", "minimumDepositAmount"].forEach(key => { if (!Number.isFinite(Number(next.reservation[key])) || Number(next.reservation[key]) < 0) throw new Error(`${key} must be a non-negative number`); });
    ["depositRequired", "autoAssignTable", "autoLightOn", "allowLightBeforeCheckIn", "autoApplyDeposit", "allowManualDepositRemoval"].forEach(key => { if (typeof next.reservation[key] !== "boolean") throw new Error(`${key} must be boolean`); });
    ["checkInGraceMinutes", "alertRepeatMinutes", "deferMinutes", "tableFreeAlertMinutes"].forEach(key => { if (!Number.isInteger(Number(next.reservation[key])) || Number(next.reservation[key]) < 1) throw new Error(`${key} must be a positive integer`); });
    if (!Number.isInteger(Number(next.reservation.alertSoundVolume)) || Number(next.reservation.alertSoundVolume) < 0 || Number(next.reservation.alertSoundVolume) > 100) throw new Error("alertSoundVolume must be between 0 and 100");
    ["alertEnabled", "alertSoundEnabled", "deferredPriorityEnabled", "autoForfeitNoShowDeposit"].forEach(key => { if (typeof next.reservation[key] !== "boolean") throw new Error(`${key} must be boolean`); });
    if (!changes.pricingProfiles && (changes.hourlyRate !== undefined || changes.minimumCharge !== undefined || changes.hourlyRateSatang !== undefined || changes.minimumChargeSatang !== undefined)) next.pricingProfiles = next.pricingProfiles.map(profile => profile.id === next.defaultPricingProfileId ? { ...profile, rateSatang: next.hourlyRateSatang, minimumChargeSatang: next.minimumChargeSatang, roundingRule: next.roundingRule } : profile);
    next.roundingRule = "UP_TO_BAHT";
    next.pricingProfiles = (next.pricingProfiles || []).map(profile => normalizePricingProfile({ ...profile, roundingRule: "UP_TO_BAHT" })); if (!next.pricingProfiles.some(profile => profile.id === next.defaultPricingProfileId)) throw new Error("defaultPricingProfileId must exist in pricingProfiles");
    next.hourlyRate = Number(satangToBaht(next.hourlyRateSatang)); next.minimumCharge = Number(satangToBaht(next.minimumChargeSatang));
    return this.repository.replace(next);
  }
}
module.exports = { SettingsService, normalizeSettings, DEFAULTS };
