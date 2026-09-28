require('ts-node/register/transpile-only');

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { DataSource } = require('typeorm');
const { WatchedEntryLevel } = require('../src/watched-levels/watched-level.entity.ts');

const csvPath = path.resolve(__dirname, '../../reacciones_boom_crash_365.csv');

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ';' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map((value) => value.trim().replace(/^"|"$/g, ''));
}

function parseCsvRows(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) {
    throw new Error('El CSV no tiene cabecera o no tiene filas de datos.');
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const rows = [];

  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    rows.push(row);
  }

  return rows;
}

function mapDirection(tipo) {
  const value = String(tipo || '').trim().toUpperCase();
  if (value === 'ALCISTA') return 'BUY';
  if (value === 'BAJISTA') return 'SELL';
  return 'BUY';
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().replace(/\s+/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

async function main() {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`No existe el CSV: ${csvPath}`);
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsvRows(content);

  if (rows.length === 0) {
    throw new Error('No se encontraron filas válidas en el CSV.');
  }

  const AppDataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    username: process.env.DB_USERNAME || 'deriv_user',
    password: String(process.env.DB_PASSWORD || 'deriv_pass').replace(/^['"]|['"]$/g, ''),
    database: process.env.DB_DATABASE || 'deriv_db',
    entities: [WatchedEntryLevel],
    synchronize: true,
    logging: false,
  });

  try {
    await AppDataSource.initialize();

    const repository = AppDataSource.getRepository(WatchedEntryLevel);
    const inserted = [];

    for (const row of rows) {
      const symbol = String(row.indice || '').trim().toUpperCase();
      const entryPrice = toNumber(row.nivel_central || row.nivel || row.entryPrice);

      if (!symbol || !Number.isFinite(entryPrice) || entryPrice <= 0) {
        continue;
      }

      const existing = await repository.findOne({
        where: { symbol, entryPrice, status: 'PENDING' },
      });
      if (existing) {
        continue;
      }

      const direction = mapDirection(row.tipo_reaccion);
      const lot = (() => {
        const symbolUpper = symbol.toUpperCase();
        return symbolUpper.includes('CRASH') || symbolUpper.includes('BOOM1000') ? 0.5 : 1;
      })();

      const entity = repository.create({
        symbol,
        direction,
        entryPrice,
        lot,
        multipleReactions: true,
        status: 'PENDING',
        note: 'Importado desde reacciones_boom_crash_365.csv',
      });

      const saved = await repository.save(entity);
      inserted.push(saved);
    }

    console.log(`Importación completada. Registros insertados: ${inserted.length}`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error('ERROR importando CSV:', error.message);
  process.exit(1);
});
