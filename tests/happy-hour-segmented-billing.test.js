const test = require("node:test");
const assert = require("node:assert/strict");
const { snapshotSegmentedPricing, snapshotPricing, isSegmented, calculateSegmentedCharge, resolveEffectiveProfile } = require("../domain/pricing");

// Happy Hour used to resolve one rate at table-open and charge it for the whole session, so a
// customer who opened five minutes before the discount window closed played all night at the
// discounted rate — and someone already playing when it opened never got it. Billing now follows
// the clock: each stretch is charged at the rate that was actually in force during it.
//
// Times below are UTC; the shop is Asia/Bangkok (UTC+7), so 08:00Z = 15:00 local.
const PROFILE = { id: "p1", name: "ทั่วไป", unit: "HOUR", rateSatang: 12000, minimumChargeSatang: 0, roundingRule: "NONE",
  timeRules: [{ id: "hh", name: "Happy Hour", weekdays: [], startTime: "14:00", endTime: "17:00", rateSatang: 10000 }] };
const snap = () => snapshotSegmentedPricing(PROFILE);
const charge = session => calculateSegmentedCharge(snap(), session);

test("a session that crosses out of Happy Hour is split at the boundary and billed at both rates", () => {
  // 15:30 → 19:30 local: 90 min inside the window at ฿100, 150 min after it at ฿120.
  const result = charge({ openedAt: "2026-08-20T08:30:00Z", endsAt: "2026-08-20T12:30:00Z" });
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].rateSatang, 10000);
  assert.equal(result.segments[0].seconds, 90 * 60);
  assert.equal(result.segments[0].satang, 15000);
  assert.equal(result.segments[0].ruleName, "Happy Hour");
  assert.equal(result.segments[1].rateSatang, 12000);
  assert.equal(result.segments[1].seconds, 150 * 60);
  assert.equal(result.segments[1].satang, 30000);
  assert.equal(result.chargeSatang, 45000);
  // The old flat model charged the open-time rate for everything: 4h × ฿100 = ฿400.
  assert.notEqual(result.chargeSatang, 40000);
});

test("opening minutes before Happy Hour ends no longer buys the discount for the whole night", () => {
  // 16:55 → 23:00 local. The exploit the flat model allowed: ~6h at the discounted rate.
  const result = charge({ openedAt: "2026-08-20T09:55:00Z", endsAt: "2026-08-20T16:00:00Z" });
  assert.equal(result.segments[0].seconds, 5 * 60, "only the five minutes actually inside the window");
  assert.equal(result.segments[0].rateSatang, 10000);
  assert.equal(result.segments[1].rateSatang, 12000);
  assert.equal(result.chargeSatang, 834 + 72000, "฿8.34 for the five discounted minutes, ฿720 for the six hours after");
});

test("a session entirely inside one rate produces a single segment", () => {
  const result = charge({ openedAt: "2026-08-20T08:00:00Z", endsAt: "2026-08-20T09:00:00Z" });
  assert.equal(result.segments.length, 1);
  assert.equal(result.chargeSatang, 10000);
});

test("a session that starts before Happy Hour and runs into it gets the discount for that stretch", () => {
  // 13:00 → 15:00 local: an hour at the base rate, then an hour of Happy Hour. The flat model
  // charged ฿120 for both hours because the window had not opened yet at table-start.
  const result = charge({ openedAt: "2026-08-20T06:00:00Z", endsAt: "2026-08-20T08:00:00Z" });
  assert.deepEqual(result.segments.map(segment => segment.rateSatang), [12000, 10000]);
  assert.equal(result.chargeSatang, 12000 + 10000);
});

test("paused time is deducted from the segment it actually happened in", () => {
  // 30 minutes paused inside the ฿120 stretch must cost the customer ฿60, not ฿50.
  const result = charge({ openedAt: "2026-08-20T08:30:00Z", endsAt: "2026-08-20T12:30:00Z",
    pauseIntervals: [{ from: "2026-08-20T11:00:00Z", to: "2026-08-20T11:30:00Z" }] });
  assert.equal(result.segments[0].seconds, 90 * 60, "the Happy Hour stretch is untouched");
  assert.equal(result.segments[1].pausedSeconds, 30 * 60);
  assert.equal(result.segments[1].seconds, 120 * 60);
  assert.equal(result.chargeSatang, 15000 + 24000);
});

test("a pause that straddles a rate boundary is split across both segments", () => {
  // Paused 16:45–17:15 local — 15 minutes either side of the 17:00 boundary.
  const result = charge({ openedAt: "2026-08-20T08:30:00Z", endsAt: "2026-08-20T12:30:00Z",
    pauseIntervals: [{ from: "2026-08-20T09:45:00Z", to: "2026-08-20T10:15:00Z" }] });
  assert.equal(result.segments[0].pausedSeconds, 15 * 60);
  assert.equal(result.segments[1].pausedSeconds, 15 * 60);
  assert.equal(result.billableSeconds, (240 - 30) * 60);
});

test("a session with no recorded pause intervals spreads its paused total proportionally", () => {
  // Sessions opened before pause intervals were recorded only know the total. Proportional is the
  // honest approximation — it must still deduct the full amount from the billable time.
  const result = charge({ openedAt: "2026-08-20T08:30:00Z", endsAt: "2026-08-20T12:30:00Z", pausedSeconds: 60 * 60 });
  assert.equal(result.billableSeconds, (240 - 60) * 60);
  assert.ok(result.segments[0].pausedSeconds > 0 && result.segments[1].pausedSeconds > 0);
});

test("the minimum charge applies once to the session, not once per segment", () => {
  const withMinimum = snapshotSegmentedPricing({ ...PROFILE, minimumChargeSatang: 5000 });
  const result = calculateSegmentedCharge(withMinimum, { openedAt: "2026-08-20T09:55:00Z", endsAt: "2026-08-20T10:05:00Z" });
  assert.equal(result.segments.length, 2, "the ten minutes straddle the 17:00 boundary");
  assert.equal(result.chargeSatang, 5000, "one minimum, not two");
});

test("an overnight Happy Hour rule is handled across midnight", () => {
  const lateNight = snapshotSegmentedPricing({ ...PROFILE, timeRules: [{ id: "late", name: "ดึก", weekdays: [], startTime: "22:00", endTime: "02:00", rateSatang: 8000 }] });
  // 21:30 → 23:30 local: 30 min at base, 90 min at the late-night rate.
  const result = calculateSegmentedCharge(lateNight, { openedAt: "2026-08-20T14:30:00Z", endsAt: "2026-08-20T16:30:00Z" });
  assert.deepEqual(result.segments.map(segment => segment.rateSatang), [12000, 8000]);
  assert.equal(result.segments[1].seconds, 90 * 60);
});

test("segment amounts always sum to the subtotal, so a printed receipt adds up", () => {
  const result = charge({ openedAt: "2026-08-20T08:17:23Z", endsAt: "2026-08-20T13:41:09Z" });
  assert.equal(result.segments.reduce((sum, segment) => sum + segment.satang, 0), result.subtotalSatang);
  assert.equal(result.segments.reduce((sum, segment) => sum + segment.seconds, 0), result.billableSeconds);
});

test("a pre-upgrade snapshot is not treated as segmented, so open sessions keep the rate they were quoted", () => {
  const legacy = snapshotPricing(resolveEffectiveProfile(PROFILE, new Date("2026-08-20T08:30:00Z")));
  assert.equal(isSegmented(legacy), false);
  assert.equal(legacy.rateSatang, 10000, "the legacy snapshot still carries its resolved Happy Hour rate");
  assert.equal(isSegmented(snap()), true);
  assert.equal(snap().rateSatang, 12000, "a segmented snapshot keeps the BASE rate so later stretches can be priced");
});
