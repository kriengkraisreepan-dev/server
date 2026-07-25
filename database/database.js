const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
function openDatabase(filename) { fs.mkdirSync(path.dirname(filename), { recursive: true }); const db = new DatabaseSync(filename); db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;"); return db; }
function closeDatabase(db) { if (db) db.close(); }
module.exports = { openDatabase, closeDatabase };
