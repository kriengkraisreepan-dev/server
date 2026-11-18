// Flashing resets the board on that USB port, and a board that resets turns off every relay it drives.
// So flashing is only unsafe while a table in play depends on THAT board. The first version refused
// whenever any table at all was in play, which on 2026-11-18 blocked re-installing a dead controller
// while customers played on tables lit from the wall switch.
const IN_PLAY = new Set(["playing", "paused", "awaiting_payment"]);

const tableNames = tables => tables.map(table => table.name || `โต๊ะ ${table.id}`).join(", ");

// identify() asks the board on the port who it is and whether any relay is on ({ deviceId, relaysOff,
// activeChannels }, or null when it cannot say). It is only asked when a table is in play, and a board
// that cannot say is treated as one that might be driving those tables.
async function flashSafetyVerdict({ tables = [], devices = [], identify = () => null } = {}) {
  const inPlay = tables.filter(table => IN_PLAY.has(table.status));
  if (!inPlay.length) return { safe: true };
  let board = null;
  try { board = await identify(); } catch { board = null; }
  if (!board?.deviceId) {
    return { safe: false, message: `${tableNames(inPlay)} ยังเปิดอยู่ และระบุไม่ได้ว่ากล่องที่เสียบ USB คือกล่องไหน จึงยังแฟลชไม่ได้` };
  }
  if (!board.relaysOff) {
    const channels = board.activeChannels?.length ? ` (ช่อง ${board.activeChannels.join(", ")})` : "";
    return { safe: false, message: `กล่องที่เสียบ USB ยังเปิด Relay อยู่${channels} กรุณาปิดผ่านขั้นตอนปกติก่อน` };
  }
  const records = new Set(devices.filter(device => device.deviceId === board.deviceId).map(device => device.id));
  const blocking = inPlay.filter(table => table.hardwareDeviceId && records.has(table.hardwareDeviceId));
  if (blocking.length) {
    return { safe: false, message: `${tableNames(blocking)} กำลังเปิดอยู่และผูกกับกล่องนี้ กรุณาปิดโต๊ะหรือยกเลิกการผูกก่อน` };
  }
  return { safe: true };
}

module.exports = { flashSafetyVerdict };
