class SeatTableError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Seat tables are a lightweight, non-hardware "zone" (bar/lounge seating) used only to park POS
// product orders for a customer who is not playing a billiard table. Unlike TableConfigurationService
// they are not counted/resized and carry no relay/pricing-profile fields — they're a plain named
// list an OWNER/MANAGER maintains from Settings.
class SeatTableService {
  constructor({ hasOpenOrders = () => false } = {}) {
    this.hasOpenOrders = hasOpenOrders;
  }

  add(seats, name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) throw new SeatTableError("VALIDATION_ERROR", "กรุณาระบุชื่อโซนที่นั่ง");
    const current = Array.isArray(seats) ? seats.map(seat => ({ ...seat })) : [];
    const nextId = current.reduce((maximum, seat) => Math.max(maximum, Number(seat.id) || 0), 0) + 1;
    const position = current.length + 1;
    current.push({ id: nextId, code: `B${String(position).padStart(2, "0")}`, name: trimmed, status: "free", createdAt: new Date().toISOString() });
    return current;
  }

  rename(seats, seatId, name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) throw new SeatTableError("VALIDATION_ERROR", "กรุณาระบุชื่อโซนที่นั่ง");
    const current = Array.isArray(seats) ? seats.map(seat => ({ ...seat })) : [];
    const seat = current.find(item => String(item.id) === String(seatId));
    if (!seat) throw new SeatTableError("SEAT_NOT_FOUND", "ไม่พบโซนที่นั่ง");
    seat.name = trimmed;
    return current;
  }

  remove(seats, seatId) {
    const current = Array.isArray(seats) ? seats.map(seat => ({ ...seat })) : [];
    const seat = current.find(item => String(item.id) === String(seatId));
    if (!seat) throw new SeatTableError("SEAT_NOT_FOUND", "ไม่พบโซนที่นั่ง");
    if (seat.status !== "free" || this.hasOpenOrders(seat.id)) {
      throw new SeatTableError("SEAT_IN_USE", `${seat.name || "โซนที่นั่งนี้"} ยังมีบิลค้างชำระอยู่ จึงลบไม่ได้`);
    }
    return current.filter(item => String(item.id) !== String(seatId));
  }
}

module.exports = { SeatTableService, SeatTableError };
