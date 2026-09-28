const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Client } = require('pg');

const csvPath = path.resolve(__dirname, '../../reacciones_boom_crash_365.csv');

function parseRows(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) {
    throw new Error('El CSV no tiene filas de datos.');
  }

  const headers = lines[0].split(';').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(';');
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = (values[index] || '').trim();
    });
    return obj;
  });
}

function parsePrice(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = String(raw).trim().replace(/\s+/g, '').replace(',', '.');
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function main() {
  const csvText = fs.readFileSync(csvPath, 'utf8');
  const rows = parseRows(csvText);

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: String(process.env.DB_PASSWORD || '').replace(/^['"]|['"]$/g, ''),
    database: process.env.DB_DATABASE,
  });

  await client.connect();
  let inserted = 0;

  for (const row of rows) {
    const symbol = String(row.indice || '').trim().toUpperCase();
    const direction = String(row.tipo_reaccion || '').trim().toUpperCase() === 'ALCISTA' ? 'BUY' : 'SELL';
    const price = parsePrice(row.nivel_central);

    if (!symbol || !Number.isFinite(price) || price <= 0) {
      continue;
    }

    const duplicate = await client.query(
      'SELECT 1 FROM watched_entry_levels WHERE symbol = $1 AND "entryPrice" = $2 AND status = $3 LIMIT 1',
      [symbol, price, 'PENDING']
    );

    if (duplicate.rowCount > 0) {
      continue;
    }

    const lot = /CRASH|BOOM1000/i.test(symbol) ? 0.5 : 1;
    await client.query(
      'INSERT INTO watched_entry_levels (symbol, direction, "entryPrice", lot, "multipleReactions", status, note, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, true, $5, $6, NOW(), NOW())',
      [symbol, direction, price, lot, 'PENDING', 'Importado desde reacciones_boom_crash_365.csv']
    );
    inserted += 1;
  }

  const total = await client.query('SELECT count(*) AS total FROM watched_entry_levels');
  console.log(JSON.stringify({ inserted, total: Number(total.rows[0].total) }));
  await client.end();
}

main().catch((error) => {
  console.error('ERROR_IMPORT', error.message);
  process.exit(1);
});
