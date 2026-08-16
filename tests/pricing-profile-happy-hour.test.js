const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveEffectiveProfile } = require("../domain/pricing");
const { TableConfigurationService } = require("../services/table-configuration-service");

// Times below are given as Thai-local wall-clock instants, converted to UTC ISO (Thai = UTC+7) so
// resolveEffectiveProfile's own +7h shift lands back on the intended local weekday/time.
const thai = (isoLocal) => new Date(new Date(isoLocal + "Z").getTime() - 7 * 60 * 60 * 1000);

function baseProfile(timeRules = []) {
  return { id: "std", name: "Standard", unit: "HOUR", rateSatang: 10000, minimumChargeSatang: 0, roundingRule: "UP_TO_BAHT", weekdayRules: [], timeRules };
}

test("no rules -> base rate", () => {
  const resolved = resolveEffectiveProfile(baseProfile(), thai("2026-08-13T10:00:00"));
  assert.equal(resolved.rateSatang, 10000);
});

test("day-only rule (no time restriction) matches every hour of the listed weekday", () => {
  // 2026-08-13 is a Thursday (weekday 4).
  const profile = baseProfile([{ id: "thu", weekdays: [4], startTime: "", endTime: "", rateSatang: 5000 }]);
  assert.equal(resolveEffectiveProfile(profile, thai("2026-08-13T00:30:00")).rateSatang, 5000);
  assert.equal(resolveEffectiveProfile(profile, thai("2026-08-13T23:59:00")).rateSatang, 5000);
});

test("day-only rule does not match a different weekday", () => {
  const profile = baseProfile([{ id: "thu", weekdays: [4], rateSatang: 5000 }]);
  // 2026-08-14 is a Friday.
  assert.equal(resolveEffectiveProfile(profile, thai("2026-08-14T10:00:00")).rateSatang, 10000);
});

test("time-only rule (every day) matches within the window and not outside it", () => {
  const profile = baseProfile([{ id: "afternoon", weekdays: [], startTime: "13:00", endTime: "17:00", rateSatang: 7000 }]);
  assert.equal(resolveEffectiveProfile(profile, thai("2026-08-13T13:00:00")).rateSatang, 7000);
  assert.equal(resolveEffectiveProfile(profile, thai("2026-08-13T16:59:00")).rateSatang, 7000);
  assert.equal(resolveEffectiveProfile(profile, thai("2026-08-13T17:00:00")).rateSatang, 10000, "end time is exclusive");
  assert.equal(resolveEffectiveProfile(profile, thai("2026-08-13T12:59:00")).rateSatang, 10000);
});

test("overnight time range (e.g. 22:00-02:00) wraps past midnight correctly", () => {
  const profile = baseProfile([{ id: "latenight", weekdays: [], startTime: "22:00", endTime: "02:00", rateSatang: 6000 }]);
  assert.equal(resolveEffectiveProfile(profile, thai("2026-08-13T23:30:00")).rateSatang, 6000);
  assert.equal(resolveEffectiveProfile(profile, thai("2026-08-14T01:30:00")).rateSatang, 6000, "past midnight, still within the overnight window");
  assert.equal(resolveEffectiveProfile(profile, thai("2026-08-14T02:00:00")).rateSatang, 10000, "end time is exclusive even overnight");
  assert.equal(resolveEffectiveProfile(profile, thai("2026-08-13T12:00:00")).rateSatang, 10000, "midday is outside the overnight window");
});

test("combined weekday + time rule requires both to match", () => {
  const profile = baseProfile([{ id: "thu-afternoon", weekdays: [4], startTime: "13:00", endTime: "17:00", rateSatang: 4000 }]);
  assert.equal(resolveEffectiveProfile(profile, thai("2026-08-13T14:00:00")).rateSatang, 4000, "Thursday afternoon matches");
  assert.equal(resolveEffectiveProfile(profile, thai("2026-08-13T20:00:00")).rateSatang, 10000, "Thursday evening does not match (wrong time)");
  assert.equal(resolveEffectiveProfile(profile, thai("2026-08-14T14:00:00")).rateSatang, 10000, "Friday afternoon does not match (wrong day)");
});

test("first matching rule wins when multiple rules overlap", () => {
  const profile = baseProfile([
    { id: "first", weekdays: [4], startTime: "13:00", endTime: "17:00", rateSatang: 4000 },
    { id: "second", weekdays: [], startTime: "13:00", endTime: "17:00", rateSatang: 9000 }
  ]);
  assert.equal(resolveEffectiveProfile(profile, thai("2026-08-13T14:00:00")).rateSatang, 4000);
});

test("resolved profile keeps minimumChargeSatang/roundingRule/unit from the base profile", () => {
  const profile = { ...baseProfile([{ id: "r", weekdays: [], rateSatang: 5000 }]), minimumChargeSatang: 2000, roundingRule: "NEAREST_BAHT" };
  const resolved = resolveEffectiveProfile(profile, thai("2026-08-13T10:00:00"));
  assert.equal(resolved.minimumChargeSatang, 2000);
  assert.equal(resolved.roundingRule, "NEAREST_BAHT");
  assert.equal(resolved.unit, "HOUR");
});

test("rejects a rule with a negative rateSatang", () => {
  const profile = baseProfile([{ id: "bad", weekdays: [], rateSatang: -100 }]);
  assert.throws(() => resolveEffectiveProfile(profile, thai("2026-08-13T10:00:00")));
});

test("TableConfigurationService assigns and clears a per-table pricing profile override", () => {
  const service = new TableConfigurationService();
  const tables = [{ id: 1, pricingProfileId: null }, { id: 2, pricingProfileId: null }];
  service.assignProfile(tables, 1, "vip", ["default", "vip"]);
  assert.equal(tables[0].pricingProfileId, "vip");
  assert.throws(() => service.assignProfile(tables, 1, "ghost", ["default", "vip"]), err => err.code === "PRICING_PROFILE_NOT_FOUND");
  service.assignProfile(tables, 1, null, ["default", "vip"]);
  assert.equal(tables[0].pricingProfileId, null);
});

test("TableConfigurationService resets every table using a deleted profile back to default", () => {
  const service = new TableConfigurationService();
  const tables = [{ id: 1, pricingProfileId: "vip" }, { id: 2, pricingProfileId: "vip" }, { id: 3, pricingProfileId: "default" }];
  const affected = service.resetTablesUsingProfile(tables, "vip");
  assert.equal(affected.length, 2);
  assert.deepEqual(tables.map(t => t.pricingProfileId), [null, null, "default"]);
});

console.log("Pricing profile / Happy Hour tests passed");
