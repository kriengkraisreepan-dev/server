"use strict";

// A3: snapshot every 30s + right after a table changes (debounce 2s); a build failure sends nothing.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSnapshotScheduler } = require("../electron/ai-bridge/scheduler");
const { memoryLogger, sampleSource } = require("./ai-bridge-helpers");

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function setup(t, { build } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let status = "available";
  const sent = [];
  let seq = 0;
  const logger = memoryLogger();
  const scheduler = createSnapshotScheduler({
    fetchSource: async () => sampleSource(status),
    build: build || (source => ({ seq: ++seq, tables: source.tables })),
    send: s => sent.push(s),
    logger,
  });
  return { scheduler, sent, logger, setStatus: s => { status = s; } };
}

async function advance(t, ms, step = 500) {
  for (let done = 0; done < ms; done += step) { t.mock.timers.tick(step); await flush(); }
}

test("A3: sends at start then every 30s", async t => {
  const { scheduler, sent } = setup(t);
  scheduler.start(30);
  await flush();
  assert.equal(sent.length, 1, "sent on online");
  await advance(t, 29000);
  assert.equal(sent.length, 1);
  await advance(t, 1000);
  assert.equal(sent.length, 2);
  await advance(t, 30000);
  assert.equal(sent.length, 3);
  scheduler.stop();
  await advance(t, 60000);
  assert.equal(sent.length, 3, "nothing after stop");
});

test("A3: a table change sends ~2s later (debounced), not on every poll", async t => {
  const { scheduler, sent, setStatus } = setup(t);
  scheduler.start(30);
  await advance(t, 3000);
  assert.equal(sent.length, 1);
  setStatus("in_use");
  await advance(t, 1000); // poll notices the change
  assert.equal(sent.length, 1, "not before the 2s debounce");
  await advance(t, 2000);
  assert.equal(sent.length, 2, "sent after debounce");
  assert.equal(sent[1].tables[0].status, "in_use");
  await advance(t, 5000);
  assert.equal(sent.length, 2, "no repeat without another change");
  // flapping within the debounce window → one send
  setStatus("available"); await advance(t, 1000);
  setStatus("in_use"); await advance(t, 1000);
  setStatus("available"); await advance(t, 1000);
  await advance(t, 3000);
  assert.equal(sent.length, 3);
  scheduler.stop();
});

test("A3 §6: if building the snapshot fails nothing is sent and it is logged", async t => {
  const { scheduler, sent, logger } = setup(t, { build: () => { throw Object.assign(new Error("bad"), { code: "SHOP_HOURS_NOT_SET" }); } });
  scheduler.start(30);
  await flush();
  assert.equal(sent.length, 0);
  assert.ok(logger.has("bridge.snapshot_failed"));
  scheduler.stop();
});
