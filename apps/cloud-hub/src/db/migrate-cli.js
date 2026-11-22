'use strict';

// `npm run migrate` — apply pending migrations to DATABASE_URL.
const { openDatabase, migrate } = require('./index');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const db = await openDatabase({ databaseUrl: process.env.DATABASE_URL });
  try {
    const applied = await migrate(db);
    console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
  } finally {
    await db.close();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
