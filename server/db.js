// pg connection pool for the CashierPOS API.
// In production (Heroku) SSL is required and the cert chain is self-signed,
// so rejectUnauthorized is false. Locally (no NODE_ENV=production) SSL is off.
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — the API cannot start without a database.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // A pooled client died unexpectedly (e.g. DB restart). Log; pg will re-create on demand.
  console.error('[db] idle client error:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
