const test = require("node:test");
const assert = require("node:assert/strict");
const { JsonBillingRepository } = require("../repositories/json-billing-repository");

// All timestamps here are explicitly injected (no real setTimeout/wall-clock waiting), unlike
// some of this codebase's other timing-sensitive tests — keeps this deterministic regardless of
// system load.
function makeRepository(initialAuditLogs = [], initialPrunedAt = null) {
  const store = { auditLogs: initialAuditLogs.slice(), auditLogPrunedAt: initialPrunedAt };
  let saveCount = 0;
  const repository = new JsonBillingRepository({ getStore: () => store, save: () => { saveCount += 1; } });
  return { repository, store, saveCount: () => saveCount };
}
const daysAgo = (now, days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

test("pruneAuditLogs removes entries older than 6 months and keeps the rest", () => {
  const now = new Date("2026-08-16T12:00:00.000Z");
  // Derive the boundary from the repository's own cutoff calculation (calendar months, not a
  // fixed day count) instead of guessing a day offset — keeps this test exact regardless of
  // which months of varying length the 6-month window happens to span.
  const { repository: cutoffProbe } = makeRepository();
  const cutoff = new Date(cutoffProbe.auditRetentionCutoffIso(now));
  const justBeforeCutoff = new Date(cutoff.getTime() - 1000).toISOString(); // outside the window — pruned
  const justAfterCutoff = new Date(cutoff.getTime() + 1000).toISOString(); // inside the window — kept
  const { repository, store } = makeRepository([
    { id: "old-1", event: "LOGIN_SUCCESS", occurredAt: daysAgo(now, 200) },
    { id: "old-2", event: "LOGIN_SUCCESS", occurredAt: justBeforeCutoff },
    { id: "recent-1", event: "LOGIN_SUCCESS", occurredAt: justAfterCutoff },
    { id: "recent-2", event: "LOGIN_SUCCESS", occurredAt: daysAgo(now, 1) }
  ]);
  const removed = repository.pruneAuditLogs(now);
  assert.equal(removed, 2);
  assert.deepEqual(store.auditLogs.map(entry => entry.id), ["recent-1", "recent-2"]);
  assert.equal(store.auditLogPrunedAt, now.toISOString());
});

test("pruneAuditLogs tolerates malformed/missing occurredAt by pruning it rather than crashing", () => {
  const now = new Date("2026-08-16T12:00:00.000Z");
  const { repository, store } = makeRepository([
    { id: "no-timestamp", event: "LOGIN_SUCCESS" },
    { id: "recent", event: "LOGIN_SUCCESS", occurredAt: daysAgo(now, 1) }
  ]);
  repository.pruneAuditLogs(now);
  assert.deepEqual(store.auditLogs.map(entry => entry.id), ["recent"]);
});

test("maybePruneAuditLogs throttles to roughly once per day, regardless of append frequency", () => {
  const now = new Date("2026-08-16T12:00:00.000Z");
  const { repository, store } = makeRepository(
    [{ id: "old", event: "LOGIN_SUCCESS", occurredAt: daysAgo(now, 200) }],
    daysAgo(now, 0.1) // pruned ~2.4 hours ago — well inside the throttle window
  );
  const removed = repository.maybePruneAuditLogs(now);
  assert.equal(removed, 0);
  assert.equal(store.auditLogs.length, 1, "throttled — the stale entry from before the window should still be untouched");
});

test("maybePruneAuditLogs runs again once the throttle window has elapsed", () => {
  const now = new Date("2026-08-16T12:00:00.000Z");
  const { repository, store } = makeRepository(
    [{ id: "old", event: "LOGIN_SUCCESS", occurredAt: daysAgo(now, 200) }],
    daysAgo(now, 2) // last pruned 2 days ago — outside the ~1 day throttle window
  );
  const removed = repository.maybePruneAuditLogs(now);
  assert.equal(removed, 1);
  assert.equal(store.auditLogs.length, 0);
});

test("appendAudit prunes as a side effect and still persists the new entry in the same save", () => {
  const now = new Date("2026-08-16T12:00:00.000Z");
  const { repository, store, saveCount } = makeRepository([
    { id: "old", event: "LOGIN_SUCCESS", occurredAt: daysAgo(now, 200) }
  ], null); // never pruned before — the unconditional first prune should fire
  repository.appendAudit({ id: "new", event: "LOGIN_SUCCESS", occurredAt: now.toISOString() });
  assert.deepEqual(store.auditLogs.map(entry => entry.id), ["new"]);
  assert.equal(saveCount(), 1, "prune + append should still be a single save, not two");
});
