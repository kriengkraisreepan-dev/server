const fs = require("fs");
const path = require("path");

class UsbFlasherLog {
  constructor({ directory, clock = () => new Date() } = {}) { this.directory = directory; this.clock = clock; }
  prune() { fs.mkdirSync(this.directory, { recursive: true }); const cutoff = this.clock().getTime() - 30*86400000; for (const name of fs.readdirSync(this.directory)) { const file=path.join(this.directory,name); try { if (/^flasher-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file); } catch {} } }
  write(event, details = {}) {
    this.prune();
    const allowed = ["operationId","port","vid","pid","chipFamily","firmwareVersion","stage","exitCode","errorCategory"];
    const safe = Object.fromEntries(allowed.filter(key => details[key] !== undefined).map(key => [key, details[key]]));
    const stamp = this.clock().toISOString(), file = path.join(this.directory, `flasher-${stamp.slice(0,10)}.jsonl`);
    fs.appendFileSync(file, `${JSON.stringify({ timestamp:stamp,event,...safe })}\n`, { encoding:"utf8", mode:0o600 });
  }
}
module.exports = { UsbFlasherLog };
