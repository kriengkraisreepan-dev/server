const { execFileSync } = require("child_process");

class WindowsComPortProvider {
  constructor({ execFile = execFileSync } = {}) { this.execFile = execFile; }
  execute(script) {
    return this.execFile("powershell.exe", ["-NoLogo","-NoProfile","-NonInteractive","-Command",script], {
      encoding: "utf8", windowsHide: true, timeout: 10000
    });
  }
  normalizePorts(value) {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    return values
      .map(item => typeof item === "string" ? { port: item, name: item, manufacturer: null, vid: null, pid: null, serialNumber: null } : item)
      .filter(item => /^COM\d+$/i.test(item?.port || ""))
      .sort((left, right) => Number(left.port.slice(3)) - Number(right.port.slice(3)));
  }
  list() {
    if (process.platform !== "win32") return [];
    // Enumerate names first: this works for standard users and is all the flasher
    // needs. esptool independently verifies chip family and flash size.
    try {
      const direct = "[System.IO.Ports.SerialPort]::GetPortNames() | ConvertTo-Json -Compress";
      const text = this.execute(direct);
      const parsed = text.trim() ? JSON.parse(text) : [];
      const ports = this.normalizePorts(parsed);
      if (ports.length) return ports;
    } catch {}

    // CIM is a secondary compatibility path for machines where SerialPort names
    // are unexpectedly unavailable. Access-denied errors remain fail-closed.
    try {
      const fallback = "$ErrorActionPreference='Stop'; Get-CimInstance Win32_PnPEntity | Where-Object {$_.Name -match '\\(COM[0-9]+\\)'} | ForEach-Object { $m=[regex]::Match($_.PNPDeviceID,'VID_([0-9A-F]{4}).*PID_([0-9A-F]{4})','IgnoreCase'); [pscustomobject]@{port=([regex]::Match($_.Name,'COM[0-9]+').Value);name=$_.Name;manufacturer=$_.Manufacturer;vid=if($m.Success){$m.Groups[1].Value.ToUpper()}else{$null};pid=if($m.Success){$m.Groups[2].Value.ToUpper()}else{$null};serialNumber=$null} } | ConvertTo-Json -Compress";
      const text = this.execute(fallback);
      return this.normalizePorts(text.trim() ? JSON.parse(text) : []);
    } catch { return []; }
  }
}
module.exports = { WindowsComPortProvider };
