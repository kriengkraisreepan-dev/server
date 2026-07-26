const crypto = require("crypto");
const { ROLES } = require("../domain/permissions");
const hashPassword = password => { const salt = crypto.randomBytes(16).toString("hex"); const hash = crypto.scryptSync(String(password), salt, 64).toString("hex"); return `scrypt$${salt}$${hash}`; };
const verifyPassword = (password, stored) => { const [algorithm, salt, expected] = String(stored || "").split("$"); if (algorithm !== "scrypt" || !salt || !expected) return false; const actual = crypto.scryptSync(String(password), salt, 64); return crypto.timingSafeEqual(actual, Buffer.from(expected, "hex")); };
class AuthService {
  constructor(repository, clock = () => new Date()) { this.repository = repository; this.clock = clock; this.sessions = new Map(); }
  bootstrap() { if (this.repository.users().length) return null; const password = process.env.LUCKY_BOOTSTRAP_PASSWORD || "ChangeMe123!"; return this.repository.add({ userId: "admin", username: "admin", passwordHash: hashPassword(password), displayName: "Owner", role: ROLES.OWNER, status: "ACTIVE", createdAt: this.clock().toISOString(), updatedAt: this.clock().toISOString(), mustChangePassword: true }); }
  login(username, password) { const user = this.repository.findByUsername(username); if (!user || !verifyPassword(password, user.passwordHash)) throw new Error("Invalid username or password"); if (user.status !== "ACTIVE") throw new Error("User is disabled"); const token = crypto.randomBytes(32).toString("hex"); this.sessions.set(token, { userId: user.userId, expiresAt: Date.now() + 8 * 60 * 60 * 1000 }); return { token, user: this.publicUser(user) }; }
  logout(token) { if (token) this.sessions.delete(token); }
  current(token) { const session = this.sessions.get(token); if (!session || session.expiresAt < Date.now()) { if (token) this.sessions.delete(token); return null; } const user = this.repository.findById(session.userId); return user?.status === "ACTIVE" ? this.publicUser(user) : null; }
  publicUser(user) { const { passwordHash, ...safe } = user; return safe; }
}
module.exports = { AuthService, hashPassword, verifyPassword };
