'use strict';

// All configuration comes from environment variables. Secrets never have defaults.
function loadConfig(env = process.env) {
  const port = Number(env.PORT || 8080);
  const dev = env.NODE_ENV === 'development';
  return {
    port,
    host: env.HOST || '0.0.0.0',
    databaseUrl: env.DATABASE_URL || null,
    pgliteDir: env.PGLITE_DIR || null,
    adminPasswordHash: env.ADMIN_PASSWORD_HASH || null,
    // What the Shop PC should connect to. Production sits behind TLS → wss://.
    publicWsUrl: env.PUBLIC_WS_URL || `ws://localhost:${port}/bridge/v1`,
    // Number of reverse proxies in front (for req.ip / rate limits). 0 = none.
    trustProxy: Number(env.TRUST_PROXY || 0),
    secureCookies: env.SECURE_COOKIES ? env.SECURE_COOKIES === 'true' : !dev,
  };
}

function assertProductionConfig(config) {
  const problems = [];
  if (!config.databaseUrl) problems.push('DATABASE_URL is required');
  if (!config.adminPasswordHash) problems.push('ADMIN_PASSWORD_HASH is required (npm run hash-password)');
  if (!config.publicWsUrl.startsWith('wss://')) problems.push('PUBLIC_WS_URL must be wss:// outside development');
  return problems;
}

module.exports = { loadConfig, assertProductionConfig };
