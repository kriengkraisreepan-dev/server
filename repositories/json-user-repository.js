class JsonUserRepository {
  constructor({ getStore, save }) { this.getStore = getStore; this.save = save; }
  users(create = false) { const store = this.getStore(); if (!Array.isArray(store.users) && create) store.users = []; return store.users || []; }
  findByUsername(username) { return this.users().find(user => user.username === String(username).toLowerCase()) || null; }
  findById(id) { return this.users().find(user => user.userId === id) || null; }
  add(user) { this.users(true).push(user); this.save(); return user; }
}
module.exports = { JsonUserRepository };
