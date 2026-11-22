"use strict";

// Snapshot timing — BRIDGE_PROTOCOL §6 / A3: every snapshotIntervalSec (30s) and right after a table
// changes, debounced 2s. The backend is polled on loopback every second to notice a change.
// If building fails, nothing is sent (the Cloud sees `stale` by itself) and the failure is logged.
const { tablesKey } = require("./snapshot-builder");

const POLL_MS = 1000;
const DEBOUNCE_MS = 2000;

function createSnapshotScheduler({ fetchSource, build, send, logger, pollMs = POLL_MS, debounceMs = DEBOUNCE_MS }) {
  let intervalTimer = null, pollTimer = null, debounceTimer = null, lastKey = null, running = false, busy = false;

  async function sendNow(reason) {
    debounceTimer = null;
    if (!running) return false;
    try {
      const source = await fetchSource();
      if (!running) return false;
      lastKey = tablesKey(source);
      const snapshot = build(source);
      send(snapshot);
      logger.info("bridge.snapshot_sent", { reason, seq: snapshot.seq, tables: snapshot.tables.length });
      return true;
    } catch (error) {
      logger.warn("bridge.snapshot_failed", { reason, error: error.code || error.message });
      return false;
    }
  }

  async function poll() {
    if (!running || busy) return;
    busy = true;
    try {
      const key = tablesKey(await fetchSource());
      if (lastKey !== null && key !== lastKey) {
        lastKey = key;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => sendNow("table_changed"), debounceMs);
        debounceTimer.unref?.();
      } else if (lastKey === null) {
        lastKey = key;
      }
    } catch {
      /* backend restarting — the next interval logs a failure if it persists */
    } finally {
      busy = false;
    }
  }

  return {
    start(intervalSec = 30) {
      this.stop();
      running = true;
      sendNow("online");
      intervalTimer = setInterval(() => sendNow("interval"), Math.max(5, intervalSec) * 1000);
      intervalTimer.unref?.();
      pollTimer = setInterval(poll, pollMs);
      pollTimer.unref?.();
    },
    stop() {
      running = false;
      clearInterval(intervalTimer);
      clearInterval(pollTimer);
      clearTimeout(debounceTimer);
      intervalTimer = pollTimer = debounceTimer = null;
      lastKey = null;
    },
    isRunning: () => running,
    sendNow,
    poll,
  };
}

module.exports = { createSnapshotScheduler, POLL_MS, DEBOUNCE_MS };
