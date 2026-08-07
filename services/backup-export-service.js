const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BACKUP_NAME = /^backup-[0-9TZ.-]+\.json$/;
const SECRET_FIELDS = /"(?:apiKey|deviceKey|secretId|ciphertext|setupCode|wifiPassword|sessionToken|enrollmentSecret)"\s*:/i;
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function within(root, candidate) { const relative = path.relative(path.resolve(root), path.resolve(candidate)); return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative); }

class BackupExportService {
  constructor({ backupDirectory, dataRoot, fsImpl = fs } = {}) { Object.assign(this, { backupDirectory: path.resolve(backupDirectory), dataRoot: path.resolve(dataRoot), fs: fsImpl }); }
  validateName(name) {
    if (typeof name !== "string" || !BACKUP_NAME.test(name) || path.basename(name) !== name || /[:\\/]/.test(name)) fail("BACKUP_NAME_INVALID", "ชื่อไฟล์สำรองข้อมูลไม่ถูกต้อง");
    return name;
  }
  inspect(name) {
    const file = path.join(this.backupDirectory, this.validateName(name));
    if (!within(this.dataRoot, file) || !within(this.backupDirectory, file)) fail("BACKUP_PATH_INVALID", "ตำแหน่งไฟล์สำรองข้อมูลไม่ปลอดภัย");
    let link, stat, real;
    try { link = this.fs.lstatSync(file); stat = this.fs.statSync(file); real = this.fs.realpathSync(file); } catch { fail("BACKUP_NOT_FOUND", "ไม่พบไฟล์สำรองข้อมูล"); }
    if (!link.isFile() || link.isSymbolicLink() || !stat.isFile() || !within(this.backupDirectory, real) || !within(this.dataRoot, real)) fail("BACKUP_SOURCE_INVALID", "ไฟล์สำรองข้อมูลไม่ผ่านการตรวจสอบ");
    let payload, raw;
    try { raw = this.fs.readFileSync(real); payload = JSON.parse(raw.toString("utf8")); } catch { fail("BACKUP_INVALID", "ไฟล์สำรองข้อมูลไม่ผ่านการตรวจสอบ จึงไม่สามารถส่งออกได้"); }
    if (!payload || typeof payload !== "object" || SECRET_FIELDS.test(raw.toString("utf8"))) fail("BACKUP_NOT_PORTABLE", "ไฟล์สำรองข้อมูลมีข้อมูลที่ไม่อนุญาตให้ส่งออก");
    if (payload.formatVersion === 2) {
      const required = ["store.json", "reservations.json", "reservation-deposits.json"];
      const digest = crypto.createHash("sha256").update(JSON.stringify(payload.files)).digest("hex");
      if (!payload.files || !payload.metadata || required.some(key => !(key in payload.files)) || digest !== payload.metadata.checksum) fail("BACKUP_INVALID", "ไฟล์สำรองข้อมูลไม่ผ่านการตรวจสอบ จึงไม่สามารถส่งออกได้");
    }
    return { file: real, name, size: stat.size, sha256: sha256(real), verificationStatus: "VERIFIED" };
  }
  export(name, destination) {
    const source = this.inspect(name), target = path.resolve(destination || "");
    if (!path.isAbsolute(target) || /^\\\\/.test(target) || /:[^\\/]+$/.test(target) || within(this.dataRoot, target) || target === source.file) fail("BACKUP_DESTINATION_INVALID", "กรุณาเลือกตำแหน่งอื่นนอกข้อมูลของโปรแกรม");
    const parent = path.dirname(target), temporary = path.join(parent, `.${path.basename(target)}.${crypto.randomBytes(12).toString("hex")}.tmp`);
    try {
      const bytes = this.fs.readFileSync(source.file), handle = this.fs.openSync(temporary, "wx", 0o600);
      try { this.fs.writeFileSync(handle, bytes); this.fs.fsyncSync(handle); } finally { this.fs.closeSync(handle); }
      if (this.fs.existsSync(target)) this.fs.unlinkSync(target);
      this.fs.renameSync(temporary, target);
      const stat = this.fs.statSync(target), digest = sha256(target);
      if (stat.size !== source.size || !crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(source.sha256))) { try { this.fs.unlinkSync(target); } catch {} fail("BACKUP_EXPORT_VERIFY_FAILED", "ไฟล์ที่บันทึกไม่ผ่านการตรวจสอบ"); }
      return { status: "SAVED", fileName: path.basename(target), size: stat.size, sha256: digest };
    } catch (error) { try { if (this.fs.existsSync(temporary)) this.fs.unlinkSync(temporary); } catch {} if (error.code?.startsWith("BACKUP_")) throw error; fail("BACKUP_EXPORT_FAILED", "ไม่สามารถบันทึกไฟล์สำรองข้อมูลได้ กรุณาเลือกตำแหน่งอื่น"); }
  }
}
module.exports = { BackupExportService, BACKUP_NAME, SECRET_FIELDS };
