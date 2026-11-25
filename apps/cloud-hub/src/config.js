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
    // A4 Messenger (Meta app). All optional: without them the webhook rejects everything.
    fbAppSecret: env.FB_APP_SECRET || null,
    fbVerifyToken: env.FB_VERIFY_TOKEN || null,
    fbPageAccessToken: env.FB_PAGE_ACCESS_TOKEN || null,
    fbAppId: env.FB_APP_ID || null,
    // A4 AI: "claude" needs ANTHROPIC_API_KEY; "rules" is the free keyword answerer.
    aiProvider: env.AI_PROVIDER || (env.ANTHROPIC_API_KEY ? 'claude' : 'rules'),
    anthropicApiKey: env.ANTHROPIC_API_KEY || null,
    aiModel: env.AI_MODEL || null,
    aiEffort: env.AI_EFFORT || 'low',
    chatRetentionDays: Number(env.CHAT_RETENTION_DAYS || 90),
  };
}

function assertProductionConfig(config) {
  const problems = [];
  if (!config.databaseUrl) problems.push('DATABASE_URL is required');
  if (!config.adminPasswordHash) problems.push('ADMIN_PASSWORD_HASH is required (npm run hash-password)');
  if (!config.publicWsUrl.startsWith('wss://')) problems.push('PUBLIC_WS_URL must be wss:// outside development');
  if (config.aiProvider === 'claude' && !config.anthropicApiKey) problems.push('AI_PROVIDER=claude needs ANTHROPIC_API_KEY');
  if (!['claude', 'rules'].includes(config.aiProvider)) problems.push('AI_PROVIDER must be claude or rules');
  return problems;
}

module.exports = { loadConfig, assertProductionConfig };
