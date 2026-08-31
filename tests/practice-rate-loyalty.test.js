const assert = require("assert");
const { normalizePricingProfile, practicePricingProfile, calculateRateSegments, calculateSegmentedCharge, snapshotSegmentedPricing } = require("../domain/pricing");
const { calculateTablePoints } = require("../domain/loyalty");
const { TableSessionService } = require("../services/table-session-service");
const { JsonMemberRepository } = require("../repositories/json-member-repository");
const { MemberService } = require("../services/member-service");

// The shop charges three prices for the same hour — ซ้อมเดี่ยว ฿80, Happy Time ฿100, ปกติ ฿120 — and
// each one now carries its own points award. These are the rules the counter has to be able to
// explain to a customer, so they are pinned here rather than left to the UI.

const profile = {
  id: "main", name: "หน้าร้าน", unit: "HOUR", rateSatang: 12000, minimumChargeSatang: 0, roundingRule: "NONE",
  pointsPerInterval: 5,
  practiceRateSatang: 8000, practicePointsPerInterval: 2,
  timeRules: [{ name: "Happy Time", weekdays: [], startTime: "", endTime: "", rateSatang: 10000, pointsPerInterval: 3 }]
};

// ---- ซ้อมเดี่ยว is a derived profile ------------------------------------------------------------
const practice = practicePricingProfile(profile);
assert.strictEqual(practice.rateSatang, 8000, "practice plays at the practice rate");
assert.strictEqual(practice.pointsPerInterval, 2, "and earns the practice rate's points");
assert.deepStrictEqual(practice.timeRules, [], "Happy Hour never undercuts the practice rate");
assert.strictEqual(practice.practice, true);
assert.strictEqual(normalizePricingProfile(profile).practice, false, "an ordinary open is not a practice session");
assert.throws(() => practicePricingProfile({ ...profile, practiceRateSatang: null }), error => error.code === "PRACTICE_RATE_NOT_CONFIGURED",
  "a shop that never set a practice rate must be refused, not quietly charged the full rate");

// ---- a practice session is charged flat, whatever the Happy Hour rules say ----------------------
const openedAt = "2026-08-31T12:00:00.000Z", twoHoursLater = "2026-08-31T14:00:00.000Z";
const practiceCharge = calculateSegmentedCharge(snapshotSegmentedPricing(practice), { openedAt, endsAt: twoHoursLater });
assert.strictEqual(practiceCharge.chargeSatang, 16000, "two hours of practice is 2 x 80 baht");
assert.strictEqual(practiceCharge.segments.length, 1, "one rate all the way through");
assert.strictEqual(practiceCharge.segments[0].pointsPerInterval, 2, "the segment carries its own points rate for the bill to award from");

// The same two hours opened normally hit the all-day Happy Time rule instead.
const normalCharge = calculateSegmentedCharge(snapshotSegmentedPricing(profile), { openedAt, endsAt: twoHoursLater });
assert.strictEqual(normalCharge.chargeSatang, 20000, "two hours at the 100 baht rule");
assert.strictEqual(normalCharge.segments[0].pointsPerInterval, 3);

// ---- the session records which mode it was opened in -------------------------------------------
const store = { tables: [{ id: 1, name: "T1", status: "free" }], sessions: [] };
const repository = {
  findTable: id => store.tables.find(table => String(table.id) === String(id)),
  findOpenSessionByTable: id => store.sessions.find(session => String(session.tableId) === String(id) && ["ACTIVE", "PAUSED"].includes(session.state)),
  createSession: session => { store.sessions.push(session); return session; },
  findSession: id => store.sessions.find(session => session.id === id),
  saveSession: session => session
};
const sessions = new TableSessionService(repository, () => new Date(openedAt));
assert.strictEqual(sessions.openSession({ tableId: 1, pricingProfile: practice }).mode, "PRACTICE");
store.sessions.length = 0;
assert.strictEqual(sessions.openSession({ tableId: 1, pricingProfile: profile }).mode, "NORMAL");

// ---- points follow the rate that was actually charged -------------------------------------------
const hour = 3600;
const at = (rateSatang, pointsPerInterval, seconds, ruleName = "") => ({ rateSatang, pointsPerInterval, seconds, ruleName });
const settings = { loyalty: { tablePointsPerHour: 5, tablePointIntervalMinutes: 60 } };

assert.strictEqual(calculateTablePoints({ playSeconds: 2 * hour, segments: [at(8000, 2, 2 * hour)], intervalMinutes: 60, defaultPointsPerInterval: 5 }).points, 4,
  "two hours of practice earns 2 + 2, not the normal rate");
assert.strictEqual(calculateTablePoints({ playSeconds: 2 * hour, segments: [at(10000, 3, 2 * hour)], intervalMinutes: 60, defaultPointsPerInterval: 5 }).points, 6);
assert.strictEqual(calculateTablePoints({ playSeconds: 2 * hour, segments: [at(12000, null, 2 * hour)], intervalMinutes: 60, defaultPointsPerInterval: 5 }).points, 10,
  "a rate with no points of its own falls back to the shop-wide setting");

// A session that ran across a rate change: each completed hour is awarded at the rate that covered
// most of it, and the leftover 40 minutes earn nothing, exactly as a single-rate session's would.
const crossed = calculateTablePoints({ playSeconds: 2 * hour + 2400, segments: [at(10000, 3, hour + 1200, "Happy Time"), at(12000, 5, hour + 1200)], intervalMinutes: 60, defaultPointsPerInterval: 5 });
assert.strictEqual(crossed.completedIntervals, 2);
assert.strictEqual(crossed.points, 8, "hour 1 was all Happy Time (3); hour 2 was 40 of its 60 minutes at the normal rate (5)");
assert.deepStrictEqual(crossed.breakdown.map(line => [line.rateSatang, line.intervals, line.points]), [[10000, 1, 3], [12000, 1, 5]],
  "the breakdown is what the counter reads back when asked why the total is 8");

// An hour split exactly down the middle — a table opened at 19:30 against a Happy Hour that ends at
// 20:00 is precisely 30/30, which is common rather than exotic — goes to the rate that awards more,
// whichever order the two stretches happened to fall in.
const tieHappyFirst = calculateTablePoints({ playSeconds: 2 * hour, segments: [at(10000, 3, 1800, "Happy Time"), at(12000, 5, hour + 1800)], intervalMinutes: 60, defaultPointsPerInterval: 5 });
assert.strictEqual(tieHappyFirst.points, 10, "hour 1 was 30/30 and pays the better rate; hour 2 is all normal");
const tieNormalFirst = calculateTablePoints({ playSeconds: 2 * hour, segments: [at(12000, 5, 1800), at(10000, 3, hour + 1800, "Happy Time")], intervalMinutes: 60, defaultPointsPerInterval: 5 });
assert.strictEqual(tieNormalFirst.points, 8, "the same tie the other way round still pays the better of the two");

// ---- nothing changes for the sessions that have no segments -------------------------------------
const members = new MemberService(new JsonMemberRepository({ getStore: () => ({ members: [], memberPointTransactions: [] }), save: () => {} }));
for (const [seconds, points] of [[1800, 0], [3600, 5], [7140, 5], [7200, 10]]) {
  assert.strictEqual(members.calculateTablePoints(seconds, settings).points, points, "the pre-segment rule is untouched");
}
assert.strictEqual(members.calculateTablePoints(2 * hour, settings, { segments: [at(8000, 2, 2 * hour)] }).points, 4);
assert.strictEqual(members.calculateTablePoints(2 * hour, settings, { segments: [at(8000, 2, 2 * hour)] }).policy.mode, "TABLE_TIME", "the snapshot shape older bills rely on still holds");

// ---- two rules at the same price but different points are still told apart ----------------------
const twoRules = { ...profile, timeRules: [
  { name: "morning", weekdays: [], startTime: "05:00", endTime: "12:00", rateSatang: 10000, pointsPerInterval: 1 },
  { name: "afternoon", weekdays: [], startTime: "12:00", endTime: "20:00", rateSatang: 10000, pointsPerInterval: 3 }
] };
// 10:00-14:00 Bangkok time (UTC+7) crosses the noon boundary between the two rules.
const split = calculateRateSegments(snapshotSegmentedPricing(twoRules), { openedAt: "2026-08-31T03:00:00.000Z", endsAt: "2026-08-31T07:00:00.000Z" });
assert.strictEqual(split.length, 2, "the same baht at different points is still a boundary");
assert.deepStrictEqual(split.map(segment => segment.pointsPerInterval), [1, 3]);
assert.strictEqual(calculateTablePoints({ playSeconds: 4 * hour, segments: split, intervalMinutes: 60, defaultPointsPerInterval: 5 }).points, 8, "2 hours x 1 + 2 hours x 3");

// ---- and the bill actually awards them ----------------------------------------------------------
// earn() reads the segments off the bill, which is where combined billing froze them at checkout.
const earnStore = { members: [], memberPointTransactions: [] };
const earning = new MemberService(new JsonMemberRepository({ getStore: () => earnStore, save: () => {} }));
const member = earning.create({ memberCode: "PRAC1", displayName: "Practice Member" }, "owner");
const practiceBill = { id: "b-practice", memberId: member.id, saleSource: "TABLE", playDurationSeconds: 2 * hour, rateSegments: [at(8000, 2, 2 * hour)] };
earning.earn(practiceBill, "cashier", settings);
assert.strictEqual(practiceBill.tablePointsEarned, 4, "two hours of practice, not the shop-wide 10");
assert.strictEqual(member.points, 4);
assert.deepStrictEqual(practiceBill.loyaltyPolicySnapshot.perRate.map(line => [line.rateSatang, line.points]), [[8000, 4]],
  "the bill keeps the per-rate working, so a reprint can still explain the number");
earning.void(practiceBill, "owner");
assert.strictEqual(member.points, 0, "voiding takes back exactly what was awarded");

console.log("Practice rate and per-rate loyalty tests passed");
