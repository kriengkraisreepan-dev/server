const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const path=require("path");

const root=path.join(__dirname,"../firmware");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("firmware project contains every architecture-locked module and document",()=>{
  for(const file of [
    "platformio.ini","README.md","src/main.cpp","src/config/ConfigService.cpp",
    "src/wifi/WifiService.cpp","src/relay/RelayService.cpp","src/api/ApiServer.cpp",
    "src/auth/AuthService.cpp","src/health/HealthService.cpp","src/storage/StorageService.cpp",
    "src/logging/Logger.cpp","src/watchdog/WatchdogService.cpp","src/utils/ApiJson.h",
    "docs/ARCHITECTURE.md","docs/API.md","docs/CONFIGURATION.md","docs/GPIO-MAPPING.md",
    "docs/TEST-PLAN.md","docs/WIRING.md","tests/test_relay/test_main.cpp"
  ])assert.ok(fs.existsSync(path.join(root,file)),file);
});

test("fixed relay mapping, supported counts, and API v1 contract are exact",()=>{
  const relay=read("include/lucky/RelayConfig.h"),api=read("src/api/ApiServer.cpp");
  assert.match(relay,/kSupportedRelayCounts\{2, 4, 8\}/);
  assert.match(relay,/kRelayGpioPins\{13, 14, 16, 17, 18, 19, 25, 26\}/);
  for(const route of ["/api/v1/health","/api/v1/device","/api/v1/device/verify","/api/v1/relays","/api/v1/relays/all/off","/api/v1/config/relay"])assert.ok(api.includes(route),route);
  assert.match(api,/X-Lucky-Device-Key/);
  assert.match(api,/RELAY_CHANNEL_NOT_AVAILABLE/);
  assert.match(api,/UNSUPPORTED_RELAY_COUNT/);
  assert.match(api,/restartRequired.*false/s);
});

test("safe boot precedes Wi-Fi, API, and watchdog startup",()=>{
  const source=read("src/main.cpp");
  // config.initialize() moved ahead of relays.safeInitializeAllPins() on 2026-08-14 for
  // per-device relay polarity support — it's a local NVS read (no network), and
  // safeInitializeAllPins() needs to know this board's polarity before it drives any pin, or an
  // active-high board would briefly get energized by a "safe" write that assumed active-low.
  const order=["config.initialize()","relays.safeInitializeAllPins()","relays.initialize","wifi.initialize()","api.initialize()","watchdog.initialize()"].map(token=>source.indexOf(token));
  assert.ok(order.every(index=>index>=0),JSON.stringify(order));
  assert.deepEqual([...order].sort((a,b)=>a-b),order);
  assert.doesNotMatch(source,/delay\s*\(/);
});

test("hardware and NVS access remain isolated to their owning modules",()=>{
  const sources=fs.readdirSync(path.join(root,"src"),{recursive:true}).filter(file=>String(file).endsWith(".cpp")||String(file).endsWith(".h"));
  for(const relative of sources){
    const normalized=String(relative).replaceAll("\\","/"),content=read(`src/${normalized}`);
    if(/digitalWrite/.test(content))assert.equal(normalized,"relay/ArduinoGpioDriver.h");
    if(/pinMode|digitalRead/.test(content))assert.ok(["relay/ArduinoGpioDriver.h","setup/SetupModeService.cpp"].includes(normalized),normalized);
    if(/#include\s*<Preferences\.h>/.test(content))assert.equal(normalized,"storage/StorageService.h");
  }
});

test("native tests cover 2, 4, 8, invalid counts, disabled pins, and runtime shrink",()=>{
  const source=read("tests/test_relay/test_main.cpp");
  for(const token of ["Channels2","Channels4","Channels8","{1, 3, 6, 16}","turnOn(3)","turnOn(5)","turnOn(9)","testRuntimeShrinkTurnsEverythingOff"])assert.ok(source.includes(token),token);
});
