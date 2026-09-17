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
    current.push({ id: nextId, code: `B${String(position).padStart(2, "0")}`, name: trimmed, status: "free", nickname: null, createdAt: new Date().toISOString() });
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

  // A nickname is a transient label for whoever is currently occupying the seat (e.g. "คุณเอ") —
  // separate from the zone's own permanent name. Unlike rename(), an empty value is valid: it
  // clears the nickname rather than being rejected, since "no nickname" is the normal resting
  // state once nobody is parked there. createSeatBill also clears it once the tab is paid off, so
  // it never survives past the customer it was set for.
  setNickname(seats, seatId, nickname) {
    const current = Array.isArray(seats) ? seats.map(seat => ({ ...seat })) : [];
    const seat = current.find(item => String(item.id) === String(seatId));
    if (!seat) throw new SeatTableError("SEAT_NOT_FOUND", "ไม่พบโซนที่นั่ง");
    seat.nickname = String(nickname || "").trim() || null;
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
