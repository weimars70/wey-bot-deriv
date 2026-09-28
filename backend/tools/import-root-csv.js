const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Client } = require('pg');

const csvPath = path.resolve(__dirname, '../../reacciones_boom_crash_365.csv');

function parseCsvRows(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) throw new Error('El CSV no tiene cabecera ni datos.');

  const headers = lines[0].split(';').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(';');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] || '').trim();
    });
    return row;
  });
}

function parsePrice(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().replace(/\s+/g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function mapDirection(tipo) {
  const t = String(tipo || '').trim().toUpperCase();
  if (t === 'ALCISTA') return 'BUY';
  if (t === 'BAJISTA') return 'SELL';
  return 'BUY';
}

async function ensureColumn(client) {
  const cols = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'watched_entry_levels'"
  );
  const hasBacktesting = cols.rows.some((row) => row.column_name === 'backtesting');

  if (!hasBacktesting) {
    await client.query('ALTER TABLE watched_entry_levels ADD COLUMN backtesting BOOLEAN NOT NULL DEFAULT FALSE');
  }
}

async function main() {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`No existe el CSV: ${csvPath}`);
  }

  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsvRows(text);

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: String(process.env.DB_PASSWORD || '').replace(/^['"]|['"]$/g, ''),
    database: process.env.DB_DATABASE,
  });

  await client.connect();

  await ensureColumn(client);

  let inserted = 0;
  for (const row of rows) {
    const symbol = String(row.indice || '').trim().toUpperCase();
    const price = parsePrice(row.nivel_central);
    const direction = mapDirection(row.tipo_reaccion);

    if (!symbol || !Number.isFinite(price) || price <= 0) {
      continue;
    }

    const exists = await client.query(
      'SELECT 1 FROM watched_entry_levels WHERE symbol = $1 AND "entryPrice" = $2 LIMIT 1',
      [symbol, price]
    );
    if (exists.rowCount > 0) {
      continue;
    }

    const lot = /CRASH|BOOM1000/i.test(symbol) ? 0.5 : 1;

    await client.query(
      `INSERT INTO watched_entry_levels
       (symbol, direction, "entryPrice", lot, "multipleReactions", status, note, backtesting, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, true, 'PENDING', 'Importado desde reacciones_boom_crash_365.csv', true, NOW(), NOW())`,
      [symbol, direction, price, lot]
    );

    inserted += 1;
  }

  const total = await client.query('SELECT COUNT(*)::int AS total FROM watched_entry_levels');
  console.log(JSON.stringify({ inserted, total: total.rows[0].total }));
  await client.end();
}

main().catch((error) => {
  console.error('ERROR_IMPORT', error.message);
  process.exit(1);
});
