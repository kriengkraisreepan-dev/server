"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, ".."), output = path.join(root, "output");
const source = path.join(root, "tools", "offline-key-ceremony");
const nodePath = "C:\\Program Files\\nodejs\\node.exe";
const expectedNode = { version: "v24.18.0", sha256: "9A4EB5F1C29C6A2E93852EAD46B999E284A6A5CA8BAB4D4E241D587D025A52DE", signer: "OpenJS Foundation", thumbprint: "CECD9673E955CA766047DD43706D31E48A6BD3B5" };
const digest = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
if (!fs.existsSync(nodePath) || digest(nodePath) !== expectedNode.sha256) throw new Error("Approved Node.js runtime SHA-256 mismatch");
const version = spawnSync(nodePath, ["--version"], { encoding: "utf8", windowsHide: true });
if (version.status !== 0 || version.stdout.trim() !== expectedNode.version) throw new Error("Approved Node.js version mismatch");
const signature = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `$s=Get-AuthenticodeSignature -LiteralPath '${nodePath.replaceAll("'", "''")}';[pscustomobject]@{status=[string]$s.Status;subject=$s.SignerCertificate.Subject;thumbprint=$s.SignerCertificate.Thumbprint}|ConvertTo-Json -Compress`], { encoding: "utf8", windowsHide: true, timeout: 60000 });
if (signature.status !== 0) throw new Error("Unable to verify Node.js Authenticode signature");
const signed = JSON.parse(signature.stdout);
if (signed.status !== "Valid" || !signed.subject.includes(expectedNode.signer) || signed.thumbprint !== expectedNode.thumbprint) throw new Error("Node.js signer is not approved");

const id = "lucky-production-key-ceremony-tool-v1-win-x64", stage = path.join(output, id), archive = `${stage}.zip`;
fs.rmSync(stage, { recursive: true, force: true }); fs.rmSync(archive, { force: true }); fs.mkdirSync(stage, { recursive: true });
for (const name of ["ceremony.js", "verify-bundle.js", "START-CEREMONY.cmd", "VERIFY-BUNDLE.cmd", "README-TH.txt"]) fs.copyFileSync(path.join(source, name), path.join(stage, name));
fs.copyFileSync(nodePath, path.join(stage, "node.exe"));
const bundledNotices = path.join(root, "node_modules", "electron", "dist", "LICENSES.chromium.html");
if (!fs.existsSync(bundledNotices)) throw new Error("Bundled Node.js third-party notices are missing");
const noticeMatch = fs.readFileSync(bundledNotices, "utf8").match(/<pre>Node\.js is licensed for use as follows:[\s\S]*?<\/pre>/);
if (!noticeMatch) throw new Error("Unable to locate the Node.js license block for the bundled 24.18.0 runtime");
const nodeLicense = noticeMatch[0].replace(/^<pre>|<\/pre>$/g, "").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
fs.writeFileSync(path.join(stage, "NODE-LICENSE.txt"), `${nodeLicense.trim()}\n`, "utf8");
const files = fs.readdirSync(stage).sort().map(name => ({ path: name, size: fs.statSync(path.join(stage, name)).size, sha256: digest(path.join(stage, name)) }));
const serialized = files.map(item => `${item.path}\n${item.size}\n${item.sha256}`).join("\n");
if (/-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----|production-private\.pem/i.test(serialized)) throw new Error("Private key material/path found in package inventory");
const manifest = { schemaVersion: 1, classification: "OFFLINE PRODUCTION KEY CEREMONY TOOL — NO PRIVATE KEY INCLUDED", createdAt: new Date().toISOString(), platform: "win32-x64", networkRequired: false, node: expectedNode, files };
fs.writeFileSync(path.join(stage, "TOOL-MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const verify = spawnSync(path.join(stage, "node.exe"), [path.join(stage, "verify-bundle.js")], { cwd: stage, encoding: "utf8", windowsHide: true });
if (verify.status !== 0 || !verify.stdout.includes("BUNDLE VERIFICATION: PASS")) throw new Error("Staged ceremony tool verification failed");
// tar.exe (bsdtar) treats an absolute -f argument starting with a drive letter (e.g.
// "C:\...") as a "host:path" remote-archive spec and fails with "Cannot connect to C:
// resolve failed" -- pass a plain relative filename with cwd set to the output directory
// instead, which sidesteps the drive-letter parsing entirely.
const packed = spawnSync("tar.exe", ["-a", "-c", "-f", `${id}.zip`, id], { cwd: output, encoding: "utf8", windowsHide: true, timeout: 300000 });
if (packed.status !== 0) throw new Error("Unable to create ceremony tool ZIP");
process.stdout.write(`${JSON.stringify({ archive, bytes: fs.statSync(archive).size, sha256: digest(archive), node: expectedNode, privateKeyIncluded: false, productionKeyCreated: false }, null, 2)}\n`);
