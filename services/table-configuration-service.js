class TableConfigurationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

class TableConfigurationService {
  constructor({ hasActiveSession = () => false, hasActiveReservation = () => false } = {}) {
    this.hasActiveSession = hasActiveSession;
    this.hasActiveReservation = hasActiveReservation;
  }

  resize(tables, requestedCount) {
    const count = Number(requestedCount);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      throw new TableConfigurationError("INVALID_TABLE_COUNT", "จำนวนโต๊ะต้องเป็นจำนวนเต็มระหว่าง 1 ถึง 100");
    }
    const current = Array.isArray(tables) ? tables.map(table => ({ ...table })) : [];
    if (count === current.length) return current;

    if (count < current.length) {
      const removed = current.slice(count);
      const blocked = removed.find(table => table.status !== "free" || this.hasActiveSession(table.id) || this.hasActiveReservation(table.id));
      if (blocked) {
        throw new TableConfigurationError("TABLE_IN_USE", `${blocked.name || `โต๊ะ ${blocked.id}`} ยังใช้งานหรือมีการจองอยู่ จึงลดจำนวนโต๊ะไม่ได้`);
      }
      return current.slice(0, count);
    }

    let nextId = current.reduce((maximum, table) => Math.max(maximum, Number(table.id) || 0), 0) + 1;
    while (current.length < count) {
      const position = current.length + 1;
      current.push({
        id: nextId++,
        code: `T${String(position).padStart(2, "0")}`,
        name: `โต๊ะ ${position}`,
        relay: position,
        status: "free",
        memberId: null,
        startTime: null,
        items: []
      });
    }
    return current;
  }
}

module.exports = { TableConfigurationService, TableConfigurationError };
