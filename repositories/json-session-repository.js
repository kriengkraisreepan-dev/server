const { isOpenState } = require("../domain/session-state");
class JsonSessionRepository {
  constructor(state) { this.state = state; if (!Array.isArray(this.state.sessions)) this.state.sessions = []; }
  findTable(tableId) { return this.state.tables.find(table => String(table.id) === String(tableId)) || null; }
  findSession(sessionId) { return this.state.sessions.find(session => session.id === sessionId) || null; }
  findOpenSessionByTable(tableId) { return this.state.sessions.find(session => String(session.tableId) === String(tableId) && isOpenState(session.state)) || null; }
  createSession(session) { if (this.findSession(session.id)) throw new Error("Duplicate session ID"); this.state.sessions.push(session); return session; }
  saveSession(session) { const index = this.state.sessions.findIndex(item => item.id === session.id); if (index < 0) throw new Error("Session not found"); this.state.sessions[index] = session; return session; }
}
module.exports = { JsonSessionRepository };
