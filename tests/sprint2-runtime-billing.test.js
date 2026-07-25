const assert = require("assert");
const { bahtToSatang } = require("../domain/money");
const { calculateSessionCharge, calculateSessionPreview } = require("../domain/pricing");
const { JsonSessionRepository } = require("../repositories/json-session-repository");
const { TableSessionService } = require("../services/table-session-service");

function legacyChargeBaht(seconds, hourlyRate = 100, minimum = 50) { return Math.max(minimum, seconds / 3600 * hourlyRate); }
const profile = { id: "standard", unit: "HOUR", rateSatang: 10000, minimumChargeSatang: 5000, roundingRule: "UP_TO_BAHT" };
for (const seconds of [1800, 3600, 7200]) assert.strictEqual(calculateSessionCharge(profile, seconds), bahtToSatang(legacyChargeBaht(seconds)));
assert.strictEqual(calculateSessionPreview(profile, 3601), 10003);
assert.strictEqual(calculateSessionCharge(profile, 3601), 10100); // New policy rounds final bill once up to a whole baht.

const state = { tables: [{ id: 1, code: "T01", name: "Table 1", status: "free", items: [] }] };
let writes = 0, now = new Date("2026-01-01T00:00:00.000Z");
const repository = new JsonSessionRepository({ getStore: () => state, save: () => { writes++; } });
const service = new TableSessionService(repository, () => now);
const session = service.openSession({ tableId: 1, pricingProfile: profile });
assert.strictEqual(state.tables[0].status, "playing"); assert.ok(state.tables[0].runtimeSessionId);
now = new Date("2026-01-01T00:10:00.000Z"); service.pauseSession(session.id); assert.strictEqual(state.tables[0].status, "paused");
now = new Date("2026-01-01T00:20:00.000Z"); service.resumeSession(session.id); assert.strictEqual(state.tables[0].status, "playing");
now = new Date("2026-01-01T01:00:01.000Z"); const closed = service.closeSession(session.id);
assert.strictEqual(closed.billableSeconds, 3001); assert.strictEqual(closed.finalChargeSatang, 8400); assert.strictEqual(state.tables[0].status, "awaiting_payment");
service.completeSession(session.id);
repository.releaseTable(1); assert.strictEqual(state.tables[0].status, "free"); assert.ok(writes >= 5);
assert.throws(() => service.cancelSession(session.id));
console.log("Sprint 2 runtime and billing regression tests passed");
