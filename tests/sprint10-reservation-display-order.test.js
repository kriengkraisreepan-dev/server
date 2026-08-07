const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf8");

test("reservation cards render newest-created items first without changing queue service order", () => {
  assert.match(app, /function reservationDisplayOrder\(items\)/);
  assert.match(app, /createdTime\(b\)-createdTime\(a\)/);
  assert.match(app, /reservationDisplayOrder\(state\.reservations\)\.map/);
  assert.match(app, /RESERVATION_CREATED/);
  assert.doesNotMatch(app, /state\.reservations\.sort\(/);

  const service = fs.readFileSync(path.join(__dirname, "../services/reservation-service.js"), "utf8");
  assert.match(service, /priorityQueue\(\)/);
  assert.match(service, /effectiveReservationAt\|\|a\.reservedAt/);
});
