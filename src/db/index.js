require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const isLocal = !connectionString || connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
const useSSL = isLocal ? false : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: connectionString || undefined,
  ssl: useSSL,
});

module.exports = { pool };
