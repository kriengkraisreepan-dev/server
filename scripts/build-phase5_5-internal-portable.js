const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, ".."), output = path.join(root, "output");
const version = require(path.join(root, "package.json")).version;
const revision = process.env.LUCKY_PORTABLE_REVISION || "revision3";
if (!/^revision[1-9][0-9]*$/.test(revision)) throw new Error("Portable revision is invalid");
const id = `phase5.5-internal-portable-${version}-${revision}-win-x64`;
const stage = path.join(output, id), archive = `${stage}.zip`;
const electronDist = path.join(root, "node_modules", "electron", "dist");
if (!fs.existsSync(path.join(electronDist, "electron.exe"))) throw new Error("Electron runtime is missing");
const firmwareRoot = path.join(root, "resources", "firmware", "internal-test"), firmwareKey = path.join(firmwareRoot, "internal-test-public.pem");
if (!fs.existsSync(firmwareKey)) throw new Error("Signed Internal Test Firmware package is missing");
new (require("../services/firmware-package-service").FirmwarePackageService)({ packageRoot: firmwareRoot, publicKey: fs.readFileSync(firmwareKey, "utf8"), mode: "internal-test" }).verify();
fs.rmSync(stage, { recursive: true, force: true }); fs.rmSync(archive, { force: true }); fs.mkdirSync(stage, { recursive: true });
fs.cpSync(electronDist, stage, { recursive: true });
fs.renameSync(path.join(stage, "electron.exe"), path.join(stage, "Lucky Snooker Manager INTERNAL TEST.exe"));
fs.writeFileSync(path.join(stage, "INTERNAL_TEST_ONLY"), "INTERNAL TEST — NOT FOR PRODUCTION\r\nDo not use customer or production data.\r\n", "utf8");
const appRoot = path.join(stage, "resources", "app"); fs.mkdirSync(appRoot, { recursive: true });
const allowed = ["config", "controllers", "domain", "drivers", "electron", "infrastructure", "public", "repositories", "resources", "services", "tools"];
const forbiddenPath = source => {
  const relative = path.relative(root, source).replaceAll("\\", "/").toLowerCase();
  const parts = relative.split("/");
  const allowedPublicKey = relative === "resources/firmware/internal-test/internal-test-public.pem";
  return parts.some(part => ["data", "test-keys", "private-keys", ".env"].includes(part)) ||
    /(^|\/)(hardware-devices\.json|hardware-secrets\.dpapi\.json)$/.test(relative) ||
    (!allowedPublicKey && /\.(pem|key|pfx|p12|dpapi)$/i.test(relative));
};
const safeSource = source => !forbiddenPath(source);
for (const name of allowed) if (fs.existsSync(path.join(root, name))) fs.cpSync(path.join(root, name), path.join(appRoot, name), { recursive: true, filter: safeSource });
for (const name of ["index.js", "package.json", "package-lock.json"]) fs.copyFileSync(path.join(root, name), path.join(appRoot, name));
fs.cpSync(path.join(root, "node_modules"), path.join(appRoot, "node_modules"), { recursive: true, filter: source => !source.startsWith(path.join(root, "node_modules", "electron")) && !source.includes(`${path.sep}.cache${path.sep}`) && safeSource(source) });
fs.writeFileSync(path.join(stage, "README-INTERNAL-TEST.txt"), "INTERNAL TEST — NOT FOR PRODUCTION\r\nWindows 10 22H2 x64 / Windows 11 x64 acceptance only.\r\nNo customer data. No distribution. No production signing.\r\nCustomer test data: %LOCALAPPDATA%\\Lucky Snooker Manager Internal Test\r\n", "utf8");
const files=[];for(const entry of fs.readdirSync(stage,{recursive:true,withFileTypes:true}))if(entry.isFile()){const full=path.join(entry.parentPath||entry.path,entry.name),relative=path.relative(stage,full).replaceAll("\\","/");files.push({path:relative,size:fs.statSync(full).size,sha256:crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex")});}files.sort((a,b)=>a.path.localeCompare(b.path));
const forbiddenPackaged = files.filter(file => /(^|\/)(data|test-keys|private-keys)(\/|$)|(^|\/)(hardware-devices\.json|hardware-secrets\.dpapi\.json)$|\.(key|pfx|p12|dpapi)$/i.test(file.path) || (/\.pem$/i.test(file.path) && !/resources\/app\/resources\/firmware\/internal-test\/internal-test-public\.pem$/i.test(file.path)));
if (forbiddenPackaged.length) throw new Error(`Forbidden secret/data artifacts in package: ${forbiddenPackaged.map(file => file.path).join(", ")}`);
fs.writeFileSync(path.join(stage,"INTERNAL-TEST-MANIFEST.json"),JSON.stringify({schemaVersion:1,classification:"INTERNAL TEST — NOT FOR PRODUCTION",applicationVersion:version,platform:"win32-x64",production:false,installer:false,productionSigned:false,files},null,2)+"\n");
const packed=spawnSync("tar.exe",["-a","-c","-f",archive,"-C",output,id],{windowsHide:true,encoding:"utf8",timeout:300000});if(packed.status!==0)throw new Error("Unable to create internal portable ZIP");
const result={package:archive,revision,sha256:crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex"),bytes:fs.statSync(archive).size,classification:"INTERNAL TEST — NOT FOR PRODUCTION"};process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
