const crypto = require("crypto");
const { HardwareError } = require("../drivers/relay-controller-driver");

const SCHEMA = "lucky-portable-migration-v1";
const forbidden = value => /"(?:apiKey|deviceKey|secretId|ciphertext|setupCode|wifiPassword)"\s*:/i.test(JSON.stringify(value));
function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
class PortableMigrationService {
  constructor({ getStore, reservations, deposits, hardwareRepository, now = () => new Date() } = {}) { Object.assign(this, { getStore, reservations, deposits, hardwareRepository, now }); }
  exportBundle(actorId) {
    const hardware = this.hardwareRepository.list().map(device => {
      const { apiKey, secretId, health, ...metadata } = device;
      return { ...metadata, credentialStatus: "REAUTHENTICATION_REQUIRED", status: "REAUTHENTICATION_REQUIRED", importedAt: null };
    });
    const payload = { store: structuredClone(this.getStore()), reservations: structuredClone(this.reservations.list()), reservationDeposits: structuredClone(this.deposits.list()), hardware };
    if (forbidden(payload)) throw new HardwareError("PORTABLE_EXPORT_SECRET_DETECTED", "ไม่สามารถสร้างชุดย้ายข้อมูลได้เนื่องจากพบข้อมูลลับ", 500);
    return { schema: SCHEMA, createdAt: this.now().toISOString(), createdBy: actorId, warning: "INTERNAL DATA TRANSFER — DEVICE REAUTHENTICATION REQUIRED", payload, sha256: digest(payload) };
  }
  validate(bundle) {
    if (!bundle || bundle.schema !== SCHEMA || !bundle.payload || digest(bundle.payload) !== bundle.sha256) throw new HardwareError("PORTABLE_BUNDLE_INVALID", "ไฟล์ย้ายข้อมูลไม่ถูกต้องหรือถูกแก้ไข", 400);
    if (forbidden(bundle.payload)) throw new HardwareError("PORTABLE_BUNDLE_SECRET_REJECTED", "ไฟล์ย้ายข้อมูลมีข้อมูลลับที่ห้ามนำข้ามเครื่อง", 400);
    const { store, reservations, reservationDeposits, hardware } = bundle.payload;
    if (!store || !Array.isArray(store.tables) || !Array.isArray(reservations) || !Array.isArray(reservationDeposits) || !Array.isArray(hardware)) throw new HardwareError("PORTABLE_BUNDLE_SCHEMA_INVALID", "โครงสร้างไฟล์ย้ายข้อมูลไม่ถูกต้อง", 400);
    const ids = hardware.map(item => item.deviceId).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw new HardwareError("PORTABLE_DEVICE_ID_AMBIGUOUS", "พบ Device ID ซ้ำในไฟล์ย้ายข้อมูล", 409);
    return true;
  }
  importedHardware(bundle) {
    this.validate(bundle);
    return bundle.payload.hardware.map(item => {
      const { apiKey, secretId, ...safe } = item;
      return { ...safe, credentialStatus: "REAUTHENTICATION_REQUIRED", status: "REAUTHENTICATION_REQUIRED", importedAt: this.now().toISOString() };
    });
  }
}
module.exports = { PortableMigrationService, PORTABLE_MIGRATION_SCHEMA: SCHEMA, portableDigest: digest };
