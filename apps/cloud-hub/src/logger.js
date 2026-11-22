'use strict';

// JSON-lines logger. Callers pass event names + small detail objects; secrets are dropped (S-5.3, S-5.4).
const { redact } = require('./audit');

function createLogger({ write = (line) => process.stdout.write(line + '\n'), silent = false } = {}) {
  const log = (level) => (event, detail = {}) => {
    if (silent) return;
    write(JSON.stringify({ ts: new Date().toISOString(), level, event, ...redact(detail) }));
  };
  return { info: log('info'), warn: log('warn'), error: log('error') };
}

module.exports = { createLogger };
