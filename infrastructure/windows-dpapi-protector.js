const { spawnSync } = require("child_process");

const PROTECT_SCRIPT = `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$inputText=[Console]::In.ReadToEnd().Trim()
$plain=[Convert]::FromBase64String($inputText)
try {
  $protected=[Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($protected))
} finally { if($plain){[Array]::Clear($plain,0,$plain.Length)} }`;
const UNPROTECT_SCRIPT = `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$inputText=[Console]::In.ReadToEnd().Trim()
$protected=[Convert]::FromBase64String($inputText)
$plain=$null
try {
  $plain=[Security.Cryptography.ProtectedData]::Unprotect($protected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($plain))
} finally { if($plain){[Array]::Clear($plain,0,$plain.Length)};if($protected){[Array]::Clear($protected,0,$protected.Length)} }`;

function encoded(script) { return Buffer.from(script, "utf16le").toString("base64"); }
class WindowsDpapiProtector {
  constructor({ run = spawnSync, platform = process.platform } = {}) { this.run = run; this.platform = platform; }
  execute(script, input) {
    if (this.platform !== "win32") throw Object.assign(new Error("DPAPI requires Windows"), { code: "DPAPI_PLATFORM_UNSUPPORTED" });
    const result = this.run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded(script)], { input, encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
    if (result.error || result.status !== 0 || !String(result.stdout || "").trim()) throw Object.assign(new Error("DPAPI operation failed"), { code: "DPAPI_OPERATION_FAILED" });
    return String(result.stdout).trim();
  }
  protect(value) {
    const plain = Buffer.from(String(value), "utf8");
    try { return this.execute(PROTECT_SCRIPT, plain.toString("base64")); }
    finally { plain.fill(0); }
  }
  unprotect(value) {
    const decoded = Buffer.from(this.execute(UNPROTECT_SCRIPT, String(value)), "base64");
    try { return decoded.toString("utf8"); }
    finally { decoded.fill(0); }
  }
}
module.exports = { WindowsDpapiProtector };
