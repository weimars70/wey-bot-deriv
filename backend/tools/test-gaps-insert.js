const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Client } = require('pg');

async function inspectGaps() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: String(process.env.DB_PASSWORD || '').replace(/^['"]|['"]$/g, ''),
    database: process.env.DB_DATABASE,
  });

  await client.connect();

  // 1. Obtener todos los gaps de apertura en M1 para BOOM600 (últimos 30 días)
  const qM1 = `
    WITH ordered AS (
      SELECT epoch, open, high, low, close,
             LAG(close) OVER (ORDER BY epoch) as prev_close,
             LAG(high) OVER (ORDER BY epoch) as prev_high,
             LAG(epoch) OVER (ORDER BY epoch) as prev_epoch
      FROM candles
      WHERE symbol = 'BOOM600' AND granularity = 60
        AND epoch >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '30 days'))
    )
    SELECT epoch, to_timestamp(epoch) as fecha,
           ROUND(prev_close::numeric, 3) as prev_close,
           ROUND(open::numeric, 3) as open,
           ROUND((open - prev_close)::numeric, 3) as gap_pts,
           ROUND(high::numeric, 3) as high,
           ROUND(low::numeric, 3) as low
    FROM ordered
    WHERE (open - prev_close) >= 1.5
      AND (epoch - prev_epoch) = 60
    ORDER BY epoch DESC;
  `;

  const resM1 = await client.query(qM1);
  console.log(`Encontrados ${resM1.rows.length} gaps M1 en BOOM600 (últimos 30 días, salto >= 1.5 pts):`);

  // Mostrar los primeros 15
  console.table(resM1.rows.slice(0, 15));

  // Verificar si ya existen en watched_entry_levels
  const existing = await client.query(
    `SELECT symbol, "entryPrice", status, note FROM watched_entry_levels WHERE symbol ILIKE '%BOOM600%'`
  );
  console.log(`\nRegistros actuales en watched_entry_levels para BOOM600: ${existing.rows.length}`);

  await client.end();
}

inspectGaps().catch(console.error);
