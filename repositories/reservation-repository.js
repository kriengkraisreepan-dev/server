const fs = require("fs");
const path = require("path");
const { atomicWriteJson, readJsonWithRecovery } = require("../infrastructure/safe-json-file");

class ReservationRepository {
  constructor(file) { this.file = file; this.items = this.read(); }
  read() { return readJsonWithRecovery(this.file, { validate: Array.isArray, create: () => [] }).value; }
  persist() { atomicWriteJson(this.file, this.items); }
  list() { return this.items.map(item => ({ ...item })); }
  findById(id) { return this.items.find(item => item.id === id) || null; }
  create(item) { this.items.push(item); this.persist(); return item; }
  update(item) { const index = this.items.findIndex(current => current.id === item.id); if (index < 0) throw new Error("Reservation not found"); this.items[index] = item; this.persist(); return item; }
}

module.exports = { ReservationRepository };
