const IPC_CHANNELS = Object.freeze({ APP_INFO: "lucky-desktop:app-info", RUNTIME_STATUS: "lucky-desktop:runtime-status", BACKUP_EXPORT: "lucky-desktop:backup-export" });
const WINDOW_SECURITY = Object.freeze({ nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false });
function trustedOrigin(port) { return `http://127.0.0.1:${Number(port)}`; }
function validateSender(event, origin) { try { const url = new URL(event.senderFrame?.url || ""); return url.origin === origin && url.pathname.startsWith("/"); } catch { return false; } }
function contentSecurityPolicy(origin) { return ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", `connect-src 'self' ${origin}`, "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"].join("; "); }
function isAllowedNavigation(candidate, origin) { try { return new URL(candidate).origin === origin; } catch { return false; } }
module.exports = { IPC_CHANNELS, WINDOW_SECURITY, trustedOrigin, validateSender, contentSecurityPolicy, isAllowedNavigation };
