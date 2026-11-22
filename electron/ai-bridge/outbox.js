"use strict";

// Local queue for Shop → Cloud messages that need an `ack` (approval.decision) — BRIDGE_PROTOCOL §3:
// kept on disk while offline and sent again after reconnect. Same envelope id on every resend, so
// the Cloud processes it once (§4).
const { atomicWrite, readJson, removeFile } = require("./files");

const MAX_ITEMS = 500;

function createOutbox({ file }) {
  let items = Array.isArray(readJson(file, [])) ? readJson(file, []) : [];
  items = items.filter(item => item && typeof item.id === "string" && typeof item.type === "string");
  const persist = () => atomicWrite(file, JSON.stringify(items));
  return {
    add(item) {
      if (items.length >= MAX_ITEMS) throw Object.assign(new Error("outbox full"), { code: "OUTBOX_FULL" });
      items.push({ id: item.id, type: item.type, ts: item.ts, payload: item.payload });
      persist();
    },
    remove(id) {
      const before = items.length;
      items = items.filter(item => item.id !== id);
      if (items.length !== before) persist();
      return items.length !== before;
    },
    list() { return items.slice(); },
    size() { return items.length; },
    clear() { items = []; removeFile(file); },
  };
}

module.exports = { createOutbox, MAX_ITEMS };
