const { spawnSync } = require("child_process");

const PORT = /^COM(?:[1-9]|[1-9][0-9]{1,2})$/i;
const SCRIPT = `$ErrorActionPreference='Stop'
$request=[Console]::In.ReadToEnd()
$portName=$env:LUCKY_SERIAL_PORT
$prefix='LUCKY_RECOVERY_RESPONSE:'
$port=New-Object System.IO.Ports.SerialPort $portName,115200,None,8,one
$port.DtrEnable=$false;$port.RtsEnable=$false;$port.ReadTimeout=500;$port.WriteTimeout=2000;$port.NewLine=[Environment]::NewLine
try{$port.Open();Start-Sleep -Milliseconds 250;$port.DiscardInBuffer();$port.WriteLine('LUCKY_RECOVERY:'+$request);$deadline=[DateTime]::UtcNow.AddSeconds(8);$buffer='';while([DateTime]::UtcNow-lt$deadline){$chunk=$port.ReadExisting();if($chunk.Length){$buffer+=$chunk;if($buffer.Length-gt 131072){$buffer=$buffer.Substring($buffer.Length-65536)};$start=$buffer.IndexOf($prefix,[StringComparison]::Ordinal);if($start-ge 0){$payloadStart=$start+$prefix.Length;$lineEnd=$buffer.IndexOf([char]10,$payloadStart);if($lineEnd-ge 0){[Console]::Out.Write($buffer.Substring($payloadStart,$lineEnd-$payloadStart).TrimEnd([char]13));exit 0}}};Start-Sleep -Milliseconds 10};throw 'response timeout'}finally{if($port.IsOpen){$port.Close()};$port.Dispose()}`;
const ENCODED = Buffer.from(SCRIPT, "utf16le").toString("base64");
class WindowsSerialRecoveryTransport {
  constructor({ run = spawnSync, platform = process.platform } = {}) { this.run = run; this.platform = platform; }
  request(port, payload) {
    if (this.platform !== "win32") throw Object.assign(new Error("การกู้คืนผ่าน USB รองรับเฉพาะ Windows"), { code: "USB_RECOVERY_PLATFORM_UNSUPPORTED", status: 409 });
    if (!PORT.test(port || "")) throw Object.assign(new Error("COM Port ไม่ถูกต้อง กรุณาเลือกใหม่"), { code: "COM_PORT_INVALID", status: 400 });
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized) > 700) throw Object.assign(new Error("คำขอผ่าน USB มีขนาดเกินกำหนด"), { code: "SERIAL_PAYLOAD_TOO_LARGE", status: 400 });
    const result = this.run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", ENCODED], { input: serialized, encoding: "utf8", windowsHide: true, timeout: 8000, maxBuffer: 64 * 1024, env: { ...process.env, LUCKY_SERIAL_PORT: port } });
    if (result.error || result.status !== 0) {
      const detail = `${result.error?.code || ""} ${result.error?.message || ""} ${result.stderr || ""}`.toLowerCase();
      if (/access.*denied|unauthorized|being used|in use|cannot open|busy/.test(detail))
        throw Object.assign(new Error("COM Port กำลังถูกใช้งาน กรุณาปิด Serial Monitor หรือโปรแกรมอื่นแล้วลองใหม่"), { code: "USB_PORT_BUSY", status: 409 });
      if (/etimedout|timeout|timed out|response timeout/.test(detail))
        throw Object.assign(new Error("กล่องไม่ตอบกลับผ่าน USB ภายในเวลาที่กำหนด กรุณาตรวจสายและ COM Port"), { code: "USB_SERIAL_TIMEOUT", status: 504 });
      throw Object.assign(new Error("สื่อสารกับกล่องผ่าน USB ไม่สำเร็จ กรุณาถอดเสียบสายแล้วลองใหม่"), { code: "USB_SERIAL_COMMUNICATION_FAILED", status: 503 });
    }
    try { const response = JSON.parse(String(result.stdout || "")); if (!response || typeof response.ok !== "boolean") throw new Error(); return response; }
    catch { throw Object.assign(new Error("ข้อมูลตอบกลับจากกล่องผ่าน USB ไม่ถูกต้อง กรุณาตรวจ Firmware และลองใหม่"), { code: "USB_SERIAL_RESPONSE_INVALID", status: 502 }); }
  }
}
module.exports = { WindowsSerialRecoveryTransport, SERIAL_PORT_PATTERN: PORT };
