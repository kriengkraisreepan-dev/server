const fs = require("fs");
const path = require("path");
const { atomicWriteJson, readJsonWithRecovery } = require("../infrastructure/safe-json-file");

class ReservationDepositRepository {
  constructor(file) { this.file = file; this.items = this.read(); }
  read() { return readJsonWithRecovery(this.file, { validate: Array.isArray, create: () => [] }).value; }
  persist() { atomicWriteJson(this.file, this.items); }
  list() { return this.items.map(item => ({ ...item })); }
  findById(id) { return this.items.find(item => item.id === id) || null; }
  findByReservationId(id) { return this.items.find(item => item.reservationId === id) || null; }
  create(item) { this.items.push({ version: 1, ...item }); this.persist(); return this.findById(item.id); }
  update(item, expectedVersion = null) {
    const index = this.items.findIndex(current => current.id === item.id); if (index < 0) throw new Error("Reservation deposit not found");
    const current = this.items[index], actual = Number(current.version || 1);
    if (expectedVersion !== null && Number(expectedVersion) !== actual) { const error = new Error("Reservation deposit version conflict"); error.code = "VERSION_CONFLICT"; throw error; }
    this.items[index] = { ...item, version: actual + 1 }; this.persist(); return this.items[index];
  }
  lock(id, expectedVersion, details = {}) {
    const item = this.findById(id); if (!item) throw new Error("Reservation deposit not found");
    if (item.status === "LOCKED" && item.lockToken === details.lockToken) return item;
    if (item.status !== "AVAILABLE") throw new Error("Only an AVAILABLE deposit may be locked");
    return this.update({ ...item, status: "LOCKED", ...details }, expectedVersion);
  }
  unlock(id, expectedVersion, lockToken) {
    const item = this.findById(id); if (!item) throw new Error("Reservation deposit not found");
    if (item.status === "AVAILABLE") return item;
    if (item.status !== "LOCKED" || (lockToken && item.lockToken !== lockToken)) throw new Error("Deposit lock does not match");
    return this.update({ ...item, status: "AVAILABLE", lockedAt: null, lockedBy: null, lockToken: null }, expectedVersion);
  }
  settle(id, expectedVersion, details) {
    const item = this.findById(id); if (!item) throw new Error("Reservation deposit not found");
    if (item.status === "SETTLED" && item.settledBillId === details.settledBillId) return item;
    if (item.status !== "LOCKED" || item.lockToken !== details.lockToken) throw new Error("Deposit must hold the matching lock before settlement");
    return this.update({ ...item, status: "SETTLED", ...details, lockToken: null }, expectedVersion);
  }
}

module.exports = { ReservationDepositRepository };
