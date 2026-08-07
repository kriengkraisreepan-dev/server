const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { performCeremony, PUBLIC_DIRECTORY, PRIVATE_DIRECTORY } = require("../tools/offline-key-ceremony/ceremony");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-key-tool-test-"));
  const roots = ["a", "b", "c"].map(name => { const value = path.join(root, name); fs.mkdirSync(value); return value; });
  return { root, roots, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const metadata = { year: "2026", sequence: "01", validFrom: "2026-08-07T00:00:00.000Z", validUntil: "2027-08-06T23:59:59.999Z", releaseOperator: "TEST OPERATOR", productionApprover: "TEST OWNER" };

test("ephemeral ceremony creates matching encrypted private copies and public-only export", () => {
  const f = fixture();
  try {
    const passphrase = Buffer.from("ephemeral-test-passphrase-32-bytes", "utf8");
    const result = performCeremony({ classification: "EPHEMERAL_TEST", allowTestDirectories: true, usbA: f.roots[0], usbB: f.roots[1], usbC: f.roots[2], passphrase, metadata });
    assert.match(result.keyId, /^lrc-prod-2026-01-[A-F0-9]{12}$/);
    const privateA = fs.readFileSync(path.join(f.roots[0], PRIVATE_DIRECTORY, "production-private.pem"));
    const privateB = fs.readFileSync(path.join(f.roots[1], PRIVATE_DIRECTORY, "production-private.pem"));
    assert.deepEqual(privateA, privateB); assert.match(privateA.toString("utf8"), /BEGIN ENCRYPTED PRIVATE KEY/);
    const key = crypto.createPrivateKey({ key: privateA, passphrase: "ephemeral-test-passphrase-32-bytes" });
    const der = crypto.createPublicKey(key).export({ type: "spki", format: "der" });
    assert.equal(crypto.createHash("sha256").update(der).digest("hex").toUpperCase(), result.fingerprintSha256);
    const publicFiles = fs.readdirSync(path.join(f.roots[2], PUBLIC_DIRECTORY));
    assert.equal(publicFiles.some(name => /private|\.key$|\.pfx$|\.p12$/i.test(name)), false);
    assert.equal(fs.readFileSync(path.join(f.roots[2], PUBLIC_DIRECTORY, "public-metadata.json"), "utf8").includes("passphrase"), false);
  } finally { f.cleanup(); }
});

test("ceremony rejects shared destinations, short passphrase, invalid lifetime and overwrite", () => {
  const f = fixture();
  try {
    const base = { classification: "EPHEMERAL_TEST", allowTestDirectories: true, usbA: f.roots[0], usbB: f.roots[1], usbC: f.roots[2], passphrase: Buffer.from("valid-ephemeral-passphrase"), metadata };
    assert.throws(() => performCeremony({ ...base, usbB: f.roots[0] }), /คนละไดรฟ์/);
    assert.throws(() => performCeremony({ ...base, passphrase: Buffer.from("short") }), /20 bytes/);
    assert.throws(() => performCeremony({ ...base, metadata: { ...metadata, validUntil: "2028-01-01T00:00:00.000Z" } }), /12 เดือน/);
    fs.mkdirSync(path.join(f.roots[0], PRIVATE_DIRECTORY));
    assert.throws(() => performCeremony(base), /ไม่เขียนทับ/);
  } finally { f.cleanup(); }
});

test("tool source has no network API, command-line passphrase or production key material", () => {
  const root = path.resolve(__dirname, "../tools/offline-key-ceremony");
  const source = fs.readFileSync(path.join(root, "ceremony.js"), "utf8");
  assert.doesNotMatch(source, /require\(["'](?:http|https|net|tls|dgram)["']\)|\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(source, /process\.argv[^\n]*(?:passphrase|privateKey)/i);
  assert.doesNotMatch(source, /-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/);
  assert.match(source, /generateKeyPairSync\("ed25519"\)/);
  assert.match(source, /cipher: "aes-256-cbc"/);
  assert.match(source, /publicKey\.export\(\{ type: "spki", format: "der" \}\)/);
  assert.match(source, /USB-A USB-B ENCRYPTED/);
  assert.match(source, /OFFLINE CONFIRMED/);
  assert.match(source, /APPROVE OFFLINE CEREMONY/);
});

test("builder pins signed Node runtime, includes license and cannot create a Production Key", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../scripts/build-offline-key-ceremony-tool.js"), "utf8");
  assert.match(source, /v24\.18\.0/);
  assert.match(source, /9A4EB5F1C29C6A2E93852EAD46B999E284A6A5CA8BAB4D4E241D587D025A52DE/);
  assert.match(source, /OpenJS Foundation/);
  assert.match(source, /CECD9673E955CA766047DD43706D31E48A6BD3B5/);
  assert.match(source, /Get-AuthenticodeSignature/);
  assert.match(source, /NODE-LICENSE\.txt/);
  assert.match(source, /productionKeyCreated:\s*false/);
  assert.doesNotMatch(source, /generateKeyPair|https?:\/\/|Invoke-WebRequest|fetch\s*\(/);
});
