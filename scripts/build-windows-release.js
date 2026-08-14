// Builds BOTH Windows release artifacts in one go:
//   1. NSIS installer (.exe) — unsigned, no certificate involved. Works on any normal machine.
//   2. APPX (.appx) — signed with the project's self-signed code-signing certificate, for
//      machines where Windows Smart App Control blocks the unsigned .exe (see
//      windows-msix-signing-workflow memory / CLAUDE conversation from 2026-08-09 for background).
//
// electron-builder's own APPX auto-signing is NOT used here: its bundled winCodeSign
// signtool.exe fails with "A required function is not present" on this machine. Instead this
// script builds an unsigned .appx and signs it afterward with the real Windows SDK signtool.exe.
//
// Usage: npm run build:win-release
// Override certificate location/password via LUCKY_CODESIGN_PFX / LUCKY_CODESIGN_PASSWORD env vars.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist_installer");
// Invoke electron-builder's real JS CLI entry point directly via node.exe, instead of the
// node_modules/.bin/electron-builder.cmd shim. On Windows, a .cmd file can only be launched
// through cmd.exe, and this project's path contains spaces (e.g. "Windows 11", "88Snooker Club")
// which trips up both execFileSync's shell:true quoting and manual cmd.exe /c argument parsing.
// Spawning node.exe with the .js file as a plain argument avoids the whole problem.
const electronBuilderCli = path.join(root, "node_modules", "electron-builder", "cli.js");

// MSIX/APPX packages only upgrade in place (Add-AppxPackage) when the new version number is
// strictly higher than what's already installed — same version is silently rejected even if the
// contents changed completely. Auto-bump the patch version on every release build so a target
// machine can always upgrade over the old install without needing to uninstall first.
function bumpPatchVersion() {
  const pkgPath = path.join(root, "package.json");
  const raw = fs.readFileSync(pkgPath, "utf8");
  const match = raw.match(/"version"\s*:\s*"(\d+)\.(\d+)\.(\d+)"/);
  if (!match) throw new Error(`Could not find a "version": "x.y.z" field in ${pkgPath}`);
  const [full, major, minor, patch] = match;
  const nextVersion = `${major}.${minor}.${Number(patch) + 1}`;
  fs.writeFileSync(pkgPath, raw.replace(full, `"version": "${nextVersion}"`));
  console.log(`Bumped package.json version ${major}.${minor}.${patch} -> ${nextVersion} (required for MSIX in-place upgrades)`);
  return nextVersion;
}
const version = bumpPatchVersion();

function findSigntool() {
  const base = "C:\\Program Files (x86)\\Windows Kits\\10\\bin";
  if (!fs.existsSync(base)) {
    throw new Error(`Windows SDK bin folder not found at ${base}. Install the "Windows SDK Signing Tools for Desktop Apps" component from https://developer.microsoft.com/windows/downloads/windows-sdk/`);
  }
  const sdkVersions = fs.readdirSync(base).filter(name => /^10\.\d/.test(name)).sort().reverse();
  for (const sdkVersion of sdkVersions) {
    const candidate = path.join(base, sdkVersion, "x64", "signtool.exe");
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("signtool.exe not found under any installed Windows SDK version.");
}

function runElectronBuilder(args) {
  console.log(`\n> node ${electronBuilderCli} ${args.join(" ")}`);
  execFileSync(process.execPath, [electronBuilderCli, ...args], { stdio: "inherit", cwd: root, env: { ...process.env, CSC_LINK: "", CSC_KEY_PASSWORD: "" } });
}

fs.rmSync(distDir, { recursive: true, force: true });

console.log("== Step 1/3: building NSIS installer (unsigned, no certificate) ==");
runElectronBuilder(["--win", "nsis", "--publish", "never"]);

const nsisExe = path.join(distDir, `88 Snooker Manager Setup ${version}.exe`);
if (!fs.existsSync(nsisExe)) throw new Error(`Expected NSIS installer not found at ${nsisExe}`);

console.log("\n== Step 2/3: building APPX (unsigned so far) ==");
runElectronBuilder(["--win", "appx", "--publish", "never"]);

const appxPath = path.join(distDir, `88 Snooker Manager ${version}.appx`);
if (!fs.existsSync(appxPath)) throw new Error(`Expected APPX not found at ${appxPath}`);

console.log("\n== Step 3/3: signing the APPX with the project code-signing certificate ==");
const pfx = process.env.LUCKY_CODESIGN_PFX || "C:\\Users\\Windows 11\\CodeSigning\\88-snooker-manager.pfx";
const pfxPassword = process.env.LUCKY_CODESIGN_PASSWORD || "LuckySnooker-CodeSign-2026";
if (!fs.existsSync(pfx)) throw new Error(`Code-signing certificate not found at ${pfx}. Set LUCKY_CODESIGN_PFX to override.`);
const signtool = findSigntool();
console.log(`Using ${signtool}`);
execFileSync(signtool, ["sign", "/fd", "SHA256", "/f", pfx, "/p", pfxPassword, "/tr", "http://timestamp.digicert.com", "/td", "SHA256", appxPath], { stdio: "inherit" });

console.log("\n✔ Done. Two release files are ready in dist_installer\\:");
console.log(`  1. ${nsisExe}`);
console.log("     -> plain installer, no certificate needed. Use on machines without Smart App Control issues.");
console.log(`  2. ${appxPath}`);
console.log("     -> signed MSIX. On a NEW target machine, first trust the certificate:");
console.log('        Import-Certificate -FilePath "C:\\Users\\Windows 11\\CodeSigning\\88-snooker-manager.cer" -CertStoreLocation "Cert:\\LocalMachine\\TrustedPeople"');
console.log('     then install: Add-AppxPackage -Path "<path to the .appx>"');
