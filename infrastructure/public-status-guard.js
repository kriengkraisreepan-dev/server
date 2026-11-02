// Protection for the one page the shop shows to customers on the internet (status.html and
// /api/public/tables), meant to sit behind a Cloudflare Tunnel. Three small independent pieces:
//
//   tunnelGuard  - a request that arrived through the tunnel may reach ONLY the public page. The tunnel's
//                  own path filter is not available on the free "quick tunnel", and even when it is, a
//                  mistake there would expose the whole shop system, so the app enforces it too.
//   rateLimiter  - fixed window per client, so one phone (or script) cannot hammer the shop PC.
//   ttlCache     - the table list is computed at most once every few seconds however many people look.

const PUBLIC_PATHS = new Set(["/status.html", "/api/public/tables"]);
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function fromLoopback(req) {
  return LOOPBACK.has(String(req.socket?.remoteAddress || ""));
}

// cloudflared connects to us from the same machine and adds these headers. Only trust them from
// loopback, so a customer on the shop Wi-Fi cannot invent one to dodge the limiter.
function viaTunnel(req) {
  return fromLoopback(req) && Boolean(req.headers["cf-connecting-ip"] || req.headers["cf-ray"]);
}

function clientKey(req) {
  if (viaTunnel(req)) {
    const forwarded = String(req.headers["cf-connecting-ip"] || "").trim();
    if (forwarded && forwarded.length <= 64) return forwarded;
  }
  return String(req.socket?.remoteAddress || "unknown");
}

function tunnelGuard() {
  return (req, res, next) => {
    if (!viaTunnel(req)) return next();
    if (req.path === "/") return res.redirect(302, "/status.html");
    if ((req.method === "GET" || req.method === "HEAD") && PUBLIC_PATHS.has(req.path)) return next();
    return res.status(404).type("text/plain").send("Not found");
  };
}

function rateLimiter({ limit = 30, windowMs = 60 * 1000, now = () => Date.now(), maxClients = 5000 } = {}) {
  const clients = new Map(); // key -> { windowStart, count }
  return (req, res, next) => {
    const current = now(), key = clientKey(req);
    if (clients.size >= maxClients) {
      for (const [id, entry] of clients) if (current - entry.windowStart >= windowMs) clients.delete(id);
      if (clients.size >= maxClients) clients.clear(); // under attack from many addresses: shed memory, keep serving
    }
    let entry = clients.get(key);
    if (!entry || current - entry.windowStart >= windowMs) { entry = { windowStart: current, count: 0 }; clients.set(key, entry); }
    entry.count += 1;
    if (entry.count > limit) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((entry.windowStart + windowMs - current) / 1000))));
      return res.status(429).json({ error: "RATE_LIMITED", message: "ขอเรียกบ่อยเกินไป กรุณาลองใหม่อีกสักครู่" });
    }
    return next();
  };
}

function ttlCache({ ttlMs = 5000, now = () => Date.now() } = {}) {
  let value, expiresAt = 0;
  return compute => {
    const current = now();
    if (current >= expiresAt) { value = compute(); expiresAt = current + ttlMs; }
    return value;
  };
}

module.exports = { tunnelGuard, rateLimiter, ttlCache, viaTunnel, clientKey, PUBLIC_PATHS };
