const fs = require("fs");
const http = require("http");
const path = require("path");
const { fork } = require("child_process");

function redact(text) { return String(text).replace(/(X-Lucky-Device-Key|apiKey|setupCode|password|sessionToken|proof)\s*[:=]\s*[^\s,}]+/gi, "$1=[REDACTED]").replace(/[A-Za-z]:\\[^\r\n"]+/g, "[PATH]"); }
class BackendSupervisor {
  constructor({ entry, programRoot, dataRoot, port, logFile, spawn = fork, now = () => Date.now(), maxRestarts = 3, restartWindowMs = 300000, readinessTimeoutMs = 30000 } = {}) { Object.assign(this, { entry, programRoot, dataRoot, port, logFile, spawn, now, maxRestarts, restartWindowMs, readinessTimeoutMs }); this.child = null; this.ownedPid = null; this.restarts = []; this.stopping = false; this.ready = false; }
  environment() { return { ...process.env, ELECTRON_RUN_AS_NODE: "1", LUCKY_DESKTOP_MODE: "1", LUCKY_INTERNAL_TEST: process.env.LUCKY_INTERNAL_TEST || (process.env.LUCKY_ELECTRON_TEST_DATA_ROOT ? "1" : "0"), LUCKY_DATA_ROOT: this.dataRoot, LUCKY_PROGRAM_ROOT: this.programRoot, LUCKY_WORKSPACE_ROOT: this.programRoot, LUCKY_ALLOW_WORKSPACE_TEST_ROOT: process.env.LUCKY_ALLOW_WORKSPACE_TEST_ROOT || "0", LUCKY_HOST: "127.0.0.1", PORT: String(this.port) }; }
  appendLog(stream, chunk) { fs.mkdirSync(path.dirname(this.logFile), { recursive: true }); const line = `${new Date().toISOString()} ${stream} ${redact(chunk).slice(0, 8192)}\n`; fs.appendFileSync(this.logFile, line, { mode: 0o600 }); const stat = fs.statSync(this.logFile); if (stat.size > 2 * 1024 * 1024) fs.truncateSync(this.logFile, 1024 * 1024); }
  launch() { if (this.child) throw Object.assign(new Error("Backend process already exists"), { code: "BACKEND_DUPLICATE" }); this.stopping = false; const child = this.spawn(this.entry, [], { cwd: this.programRoot, env: this.environment(), windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] }); this.child = child; this.ownedPid = child.pid; child.stdout?.on("data", value => this.appendLog("OUT", value)); child.stderr?.on("data", value => this.appendLog("ERR", value)); child.once("exit", (code, signal) => { const owned = this.child === child; if (owned) { this.child = null; this.ready = false; } if (owned && !this.stopping) this.onCrash?.({ code, signal }); }); return child; }
  waitUntilReady() {
    const deadline = this.now() + this.readinessTimeoutMs;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else { this.ready = true; resolve(true); }
      };
      const retry = () => {
        if (settled) return;
        if (this.now() >= deadline) return finish(Object.assign(new Error("Backend readiness timeout"), { code: "BACKEND_READINESS_TIMEOUT" }));
        setTimeout(attempt, 150);
      };
      const attempt = () => {
        if (settled) return;
        if (!this.child) return finish(Object.assign(new Error("Backend exited before readiness"), { code: "BACKEND_EXITED_BEFORE_READY" }));
        const request = http.get({ hostname: "127.0.0.1", port: this.port, path: "/", timeout: 1000 }, response => {
          response.resume();
          if (response.statusCode === 200) finish(); else retry();
        });
        request.once("error", retry);
        request.once("timeout", () => request.destroy(Object.assign(new Error("Readiness request timeout"), { code: "READINESS_REQUEST_TIMEOUT" })));
      };
      attempt();
    });
  }
  canRestart() { const cutoff = this.now() - this.restartWindowMs; this.restarts = this.restarts.filter(value => value >= cutoff); if (this.restarts.length >= this.maxRestarts) return false; this.restarts.push(this.now()); return true; }
  async stop(timeoutMs = 10000) { this.stopping = true; const child = this.child; if (!child || child.pid !== this.ownedPid) return false; return new Promise(resolve => { let settled = false; const done = value => { if (settled) return; settled = true; this.child = null; this.ready = false; resolve(value); }; child.once("exit", () => done(true)); child.kill("SIGTERM"); setTimeout(() => { if (!settled && child.pid === this.ownedPid) { child.kill("SIGKILL"); done(false); } }, timeoutMs).unref?.(); }); }
  status() { return { state: this.ready ? "READY" : this.child ? "STARTING" : "STOPPED", backendOwned: Boolean(this.child && this.child.pid === this.ownedPid), restartCount: this.restarts.length }; }
}
module.exports = { BackendSupervisor, redact };
