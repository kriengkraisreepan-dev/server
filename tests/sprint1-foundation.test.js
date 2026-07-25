const assert = require("assert");
const { bahtToSatang, satangToBaht } = require("../domain/money");
const { calculateSessionCharge } = require("../domain/pricing");
const { JsonSettingsRepository } = require("../repositories/json-settings-repository");
const { JsonSessionRepository } = require("../repositories/json-session-repository");
const { SettingsService } = require("../services/settings-service");
const { TableSessionService } = require("../services/table-session-service");

let now = new Date("2026-01-01T00:00:00.000Z");
const clock = () => now;
const state = { settings: { shopName: "Test Shop", hourlyRate: 100, minimumCharge: 50, tableCount: 2, promptPayId: "" }, tables: [{ id: 1, code: "T01", name: "Table 1" }, { id: 2, code: "T02", name: "Table 2" }] };
let saved = 0;
const settings = new SettingsService(new JsonSettingsRepository({ getStore: () => state, save: () => { saved++; } }));

assert.strictEqual(bahtToSatang("100"), 10000);
assert.strictEqual(bahtToSatang("12.34"), 1234);
assert.strictEqual(satangToBaht(1234), "12.34");
assert.throws(() => bahtToSatang("1.234"));
assert.strictEqual(calculateSessionCharge({ id: "p", unit: "HOUR", rateSatang: 10000, minimumChargeSatang: 5000, roundingRule: "NONE" }, 3000), 8334);

const updated = settings.updateSettings({ hourlyRate: "125.50", minimumCharge: "60.00", backupIntervalHours: 12 });
assert.strictEqual(updated.hourlyRateSatang, 12550); assert.strictEqual(updated.minimumChargeSatang, 6000); assert.strictEqual(updated.hourlyRate, 125.5); assert.strictEqual(updated.pricingProfiles.find(profile => profile.id === updated.defaultPricingProfileId).rateSatang, 12550); assert.strictEqual(saved, 1);
assert.throws(() => settings.updateSettings({ timeZone: "UTC" }));

const repository = new JsonSessionRepository(state), sessions = new TableSessionService(repository, clock);
const profile = { id: "weekday", unit: "HOUR", rateSatang: 10000, minimumChargeSatang: 5000, roundingRule: "NONE" };
const active = sessions.openSession({ tableId: 1, pricingProfile: profile });
profile.rateSatang = 1;
assert.throws(() => sessions.openSession({ tableId: 1, pricingProfile: profile }));
now = new Date("2026-01-01T00:10:00.000Z"); sessions.pauseSession(active.id);
assert.throws(() => sessions.pauseSession(active.id));
now = new Date("2026-01-01T00:20:00.000Z"); sessions.resumeSession(active.id);
now = new Date("2026-01-01T01:00:00.000Z"); const closed = sessions.closeSession(active.id);
assert.strictEqual(closed.billableSeconds, 3000); assert.strictEqual(closed.finalChargeSatang, 8334); assert.strictEqual(closed.pricingSnapshot.rateSatang, 10000);
assert.throws(() => sessions.resumeSession(active.id));
const cancel = sessions.openSession({ tableId: 2, pricingProfile: profile }); const cancelled = sessions.cancelSession(cancel.id); assert.strictEqual(cancelled.finalChargeSatang, 0);
console.log("Sprint 1 foundation tests passed");
