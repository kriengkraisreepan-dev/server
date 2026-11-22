'use strict';

// Production / docker entry point: `npm start`.
const { loadConfig, assertProductionConfig } = require('./config');
const { createHub } = require('./app');

(async () => {
  const config = loadConfig();
  if (process.env.NODE_ENV !== 'development') {
    const problems = assertProductionConfig(config);
    if (problems.length) {
      for (const p of problems) console.error(`config: ${p}`);
      process.exit(1);
    }
  }
  const hub = await createHub(config);
  const addr = await hub.listen();
  console.log(JSON.stringify({ event: 'hub.listening', port: addr.port, db: hub.db.kind }));
  const stop = () => hub.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
