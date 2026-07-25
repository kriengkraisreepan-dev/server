function assertIntegerSatang(value, name = "amount") { if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer satang value`); return value; }
function bahtToSatang(value) {
  const text = typeof value === "number" ? value.toFixed(2) : String(value).trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Baht value must have at most two decimal places");
  const negative = text.startsWith("-"); const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const satang = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return negative ? -satang : satang;
}
function satangToBaht(satang) { assertIntegerSatang(satang); const sign = satang < 0 ? "-" : ""; const absolute = Math.abs(satang); return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`; }
function requireNonNegativeSatang(value, name = "amount") { assertIntegerSatang(value, name); if (value < 0) throw new Error(`${name} cannot be negative`); return value; }
module.exports = { assertIntegerSatang, bahtToSatang, satangToBaht, requireNonNegativeSatang };
