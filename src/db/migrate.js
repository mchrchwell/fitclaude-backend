require('dotenv').config();
const fs = require('fs');
const path = require('path');

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl || dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')) {
  console.error(
    'DATABASE_URL must point to Railway Postgres, not localhost.\n' +
    'In Railway: open your app service → Variables → "Add variable" → "Add reference" → choose your PostgreSQL service → select DATABASE_URL.'
  );
  process.exit(1);
}

const { pool } = require('./index');

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

async function migrate() {
  const client = await pool.connect();
  try {
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query(sql);
      console.log(`Ran migration: ${file}`);
    }
    console.log('Migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
