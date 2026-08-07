"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const PRIVATE_DIRECTORY = "Lucky-Production-Signing";
const PUBLIC_DIRECTORY = "Lucky-Production-Public";
const KEY_ID_RE = /^lrc-prod-(\d{4})-(\d{2})-([A-F0-9]{12})$/;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
}

function publicFingerprint(publicKey) {
  const key = publicKey?.type === "public" ? publicKey : crypto.createPublicKey(publicKey);
  return sha256(key.export({ type: "spki", format: "der" }));
}

function atomicWrite(file, value) {
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    fs.renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch {}
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

function normalizedRoot(value, { allowTestDirectories = false } = {}) {
  const resolved = path.resolve(String(value || "").trim());
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error("ไม่พบตำแหน่ง USB ที่ระบุ");
  if (allowTestDirectories) return resolved;
  const root = path.parse(resolved).root;
  if (resolved.toLowerCase() !== root.toLowerCase()) throw new Error("ต้องระบุรากของ USB เช่น D:\\ เท่านั้น");
  if (root.toLowerCase() === path.parse(os.homedir()).root.toLowerCase()) throw new Error("ห้ามใช้ไดรฟ์ระบบสำหรับ Production Private Key");
  if (resolved.startsWith("\\\\")) throw new Error("ห้ามใช้ Network/UNC path");
  return resolved;
}

function validateMetadata(metadata) {
  const year = String(metadata.year || ""), sequence = String(metadata.sequence || "");
  const validFrom = new Date(metadata.validFrom), validUntil = new Date(metadata.validUntil);
  if (!/^20\d{2}$/.test(year) || !/^\d{2}$/.test(sequence) || sequence === "00") throw new Error("ปีหรือลำดับ Key ไม่ถูกต้อง");
  if (!Number.isFinite(validFrom.getTime()) || !Number.isFinite(validUntil.getTime()) || validUntil <= validFrom) throw new Error("ช่วงเวลาใช้งาน Key ไม่ถูกต้อง");
  if (validUntil.getTime() - validFrom.getTime() > 366 * 86400000) throw new Error("Production Key มีอายุได้ไม่เกิน 12 เดือน");
  for (const field of ["releaseOperator", "productionApprover"]) {
    const value = String(metadata[field] || "").trim();
    if (!value || value.length > 100 || /[\r\n\0]/.test(value)) throw new Error("ข้อมูลผู้อนุมัติไม่ถูกต้อง");
  }
  return { year, sequence, validFrom: validFrom.toISOString(), validUntil: validUntil.toISOString(), releaseOperator: String(metadata.releaseOperator).trim(), productionApprover: String(metadata.productionApprover).trim() };
}

function assertEmptyDestination(root, directory) {
  const destination = path.join(root, directory);
  if (fs.existsSync(destination)) throw new Error(`พบโฟลเดอร์เดิม ${destination} ระบบจะไม่เขียนทับ`);
  return destination;
}

function verifyPrivate(privatePem, passphrase, expectedFingerprint) {
  const privateKey = crypto.createPrivateKey({ key: privatePem, format: "pem", passphrase });
  const publicKey = crypto.createPublicKey(privateKey);
  if (publicFingerprint(publicKey) !== expectedFingerprint) throw new Error("Private Key backup ไม่ตรงกับ Public Key");
  return privateKey;
}

function performCeremony(options) {
  if (options.classification !== "PRODUCTION" && options.classification !== "EPHEMERAL_TEST") throw new Error("Ceremony classification ไม่ถูกต้อง");
  const allowTestDirectories = options.classification === "EPHEMERAL_TEST" && options.allowTestDirectories === true;
  const rootA = normalizedRoot(options.usbA, { allowTestDirectories });
  const rootB = normalizedRoot(options.usbB, { allowTestDirectories });
  const rootC = normalizedRoot(options.usbC, { allowTestDirectories });
  if (new Set([rootA.toLowerCase(), rootB.toLowerCase(), rootC.toLowerCase()]).size !== 3) throw new Error("USB-A, USB-B และ USB-C ต้องเป็นคนละไดรฟ์");
  const destinationA = assertEmptyDestination(rootA, PRIVATE_DIRECTORY);
  const destinationB = assertEmptyDestination(rootB, PRIVATE_DIRECTORY);
  const destinationC = assertEmptyDestination(rootC, PUBLIC_DIRECTORY);
  const metadata = validateMetadata(options.metadata || {});
  const passphrase = Buffer.isBuffer(options.passphrase) ? options.passphrase : Buffer.from(String(options.passphrase || ""), "utf8");
  if (passphrase.length < 20 || passphrase.length > 512) throw new Error("Passphrase ต้องยาวอย่างน้อย 20 bytes และไม่เกิน 512 bytes");

  const created = [];
  let privatePem;
  try {
    for (const directory of [destinationA, destinationB, destinationC]) { fs.mkdirSync(directory); created.push(directory); }
    const pair = crypto.generateKeyPairSync("ed25519");
    privatePem = Buffer.from(pair.privateKey.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase }));
    const publicPem = Buffer.from(pair.publicKey.export({ type: "spki", format: "pem" }));
    const publicDer = Buffer.from(pair.publicKey.export({ type: "spki", format: "der" }));
    const fingerprintSha256 = sha256(publicDer);
    const keyId = `lrc-prod-${metadata.year}-${metadata.sequence}-${fingerprintSha256.slice(0, 12)}`;
    if (!KEY_ID_RE.test(keyId)) throw new Error("Key ID ไม่ผ่าน contract");

    const testMessage = Buffer.from("Lucky Production Signing Ceremony Self Test\n", "utf8");
    const signature = crypto.sign(null, testMessage, pair.privateKey);
    if (!crypto.verify(null, testMessage, pair.publicKey, signature)) throw new Error("Ed25519 self-test ไม่ผ่าน");
    const tampered = Buffer.from(testMessage); tampered[0] ^= 1;
    if (crypto.verify(null, tampered, pair.publicKey, signature)) throw new Error("Tamper rejection self-test ไม่ผ่าน");

    const publicMetadata = {
      schemaVersion: 1,
      classification: options.classification,
      algorithm: "Ed25519",
      keyId,
      fingerprintSha256,
      validFrom: metadata.validFrom,
      validUntil: metadata.validUntil,
      createdAt: new Date().toISOString(),
      releaseOperator: metadata.releaseOperator,
      productionApprover: metadata.productionApprover,
      privateKeyLocations: options.classification === "PRODUCTION" ? ["USB-A", "USB-B"] : ["EPHEMERAL-TEST-A", "EPHEMERAL-TEST-B"],
      selfTest: { correctSignatureVerified: true, tamperedMessageRejected: true }
    };
    const metadataText = Buffer.from(`${JSON.stringify(publicMetadata, null, 2)}\n`, "utf8");
    const report = Buffer.from([
      "Lucky Snooker Manager — Production Key Ceremony Public Report",
      `Classification: ${options.classification}`,
      "Algorithm: Ed25519",
      `Key ID: ${keyId}`,
      `SPKI SHA-256: ${fingerprintSha256}`,
      `Valid From: ${metadata.validFrom}`,
      `Valid Until: ${metadata.validUntil}`,
      `Release Operator: ${metadata.releaseOperator}`,
      `Production Approver/OWNER: ${metadata.productionApprover}`,
      "Correct Signature Verification: PASS",
      "Modified Message Rejection: PASS",
      "Private Key Included In Public Export: NO",
      ""
    ].join("\r\n"), "utf8");

    for (const destination of [destinationA, destinationB]) {
      atomicWrite(path.join(destination, "production-private.pem"), privatePem);
      atomicWrite(path.join(destination, "production-public.pem"), publicPem);
      atomicWrite(path.join(destination, "production-public.spki.der"), publicDer);
      atomicWrite(path.join(destination, "public-metadata.json"), metadataText);
      atomicWrite(path.join(destination, "ceremony-public-report.txt"), report);
    }
    for (const [name, value] of [["production-public.pem", publicPem], ["production-public.spki.der", publicDer], ["public-metadata.json", metadataText], ["ceremony-public-report.txt", report]]) atomicWrite(path.join(destinationC, name), value);

    for (const destination of [destinationA, destinationB]) {
      const storedPrivate = fs.readFileSync(path.join(destination, "production-private.pem"));
      verifyPrivate(storedPrivate, passphrase, fingerprintSha256);
      storedPrivate.fill(0);
    }
    const publicEntries = fs.readdirSync(destinationC);
    if (publicEntries.some(name => /private|\.key$|\.pfx$|\.p12$|\.dpapi$/i.test(name))) throw new Error("Public USB มีไฟล์ที่ห้ามส่งออก");
    if (sha256(fs.readFileSync(path.join(destinationC, "production-public.spki.der"))) !== fingerprintSha256) throw new Error("Public USB fingerprint ไม่ตรงกัน");
    return publicMetadata;
  } catch (error) {
    for (const directory of created.reverse()) try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
    throw error;
  } finally {
    if (privatePem) privatePem.fill(0);
    passphrase.fill(0);
  }
}

function question(rl, label, defaultValue = "") {
  return new Promise(resolve => rl.question(`${label}${defaultValue ? ` [${defaultValue}]` : ""}: `, answer => resolve(answer.trim() || defaultValue)));
}

function hiddenQuestion(label) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") return reject(new Error("ต้องเปิดเครื่องมือจาก Console แบบ interactive"));
    process.stdout.write(`${label}: `); process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
    let value = "";
    const cleanup = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.removeListener("data", onData); process.stdout.write("\n"); };
    const onData = character => {
      if (character === "\u0003") { cleanup(); reject(new Error("ผู้ใช้ยกเลิก")); return; }
      if (character === "\r" || character === "\n") { cleanup(); resolve(value); return; }
      if (character === "\u007f" || character === "\b") { value = value.slice(0, -1); return; }
      if (character >= " " && character !== "\u007f") value += character;
    };
    process.stdin.on("data", onData);
  });
}

async function interactive() {
  console.log("Lucky Snooker Manager — OFFLINE PRODUCTION KEY CEREMONY TOOL");
  console.log("เครื่องมือนี้จะสร้าง Production Private Key จริงเฉพาะหลังยืนยันทุกขั้นตอน");
  console.log("ห้ามใช้งานหากเครื่องยังเชื่อมต่อ Network หรือ USB ไม่ได้เข้ารหัส\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (await question(rl, "พิมพ์ OFFLINE CONFIRMED") !== "OFFLINE CONFIRMED") throw new Error("ยังไม่ได้ยืนยัน Offline");
    if (await question(rl, "พิมพ์ USB-A USB-B ENCRYPTED") !== "USB-A USB-B ENCRYPTED") throw new Error("ยังไม่ได้ยืนยันว่า USB-A และ USB-B เข้ารหัสแล้ว");
    if (await question(rl, "พิมพ์ APPROVE OFFLINE CEREMONY") !== "APPROVE OFFLINE CEREMONY") throw new Error("ยังไม่ได้อนุมัติ Ceremony");
    const usbA = await question(rl, "รากไดรฟ์ USB-A เช่น D:\\");
    const usbB = await question(rl, "รากไดรฟ์ USB-B เช่น E:\\");
    const usbC = await question(rl, "รากไดรฟ์ USB-C เช่น F:\\");
    const now = new Date(), year = await question(rl, "ปี Key", String(now.getUTCFullYear()));
    const sequence = await question(rl, "ลำดับ Key สองหลัก", "01");
    const validFrom = await question(rl, "Valid From แบบ ISO UTC", now.toISOString());
    const defaultUntil = new Date(now); defaultUntil.setUTCFullYear(defaultUntil.getUTCFullYear() + 1); defaultUntil.setUTCMilliseconds(defaultUntil.getUTCMilliseconds() - 1);
    const validUntil = await question(rl, "Valid Until แบบ ISO UTC", defaultUntil.toISOString());
    const releaseOperator = await question(rl, "Release Operator");
    const productionApprover = await question(rl, "Production Approver/OWNER");
    rl.pause();
    const first = await hiddenQuestion("Private Key passphrase (ไม่แสดงบนจอ)");
    const second = await hiddenQuestion("ยืนยัน passphrase อีกครั้ง");
    if (first !== second) throw new Error("Passphrase ทั้งสองครั้งไม่ตรงกัน");
    const passphrase = Buffer.from(first, "utf8");
    const result = performCeremony({ classification: "PRODUCTION", usbA, usbB, usbC, passphrase, metadata: { year, sequence, validFrom, validUntil, releaseOperator, productionApprover } });
    console.log("\nCEREMONY COMPLETED");
    console.log(`Key ID: ${result.keyId}`);
    console.log(`SPKI SHA-256: ${result.fingerprintSha256}`);
    console.log("Private Key: USB-A และ USB-B เท่านั้น");
    console.log("Public Export: USB-C");
  } finally { rl.close(); }
}

if (require.main === module) interactive().catch(error => { console.error(`CEREMONY FAILED: ${error.message}`); process.exitCode = 1; });

module.exports = { performCeremony, publicFingerprint, sha256, validateMetadata, normalizedRoot, PRIVATE_DIRECTORY, PUBLIC_DIRECTORY };
