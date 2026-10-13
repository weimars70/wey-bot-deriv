const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Client } = require('pg');

async function check() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: String(process.env.DB_PASSWORD || '').replace(/^['"]|['"]$/g, ''),
    database: process.env.DB_DATABASE,
  });

  await client.connect();

  console.log('--- Analizando Gaps en BOOM600 últimos 30 días ---');

  // 1. Gaps M1 (Open vs Prev Close)
  for (const thresh of [0.5, 1.0, 2.0, 3.0, 5.0, 10.0]) {
    const q = `
      WITH ordered AS (
        SELECT epoch, open, high, low, close,
               LAG(close) OVER (ORDER BY epoch) as prev_close,
               LAG(high) OVER (ORDER BY epoch) as prev_high,
               LAG(epoch) OVER (ORDER BY epoch) as prev_epoch
        FROM candles
        WHERE symbol = 'BOOM600' AND granularity = 60
          AND epoch >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '30 days'))
      )
      SELECT COUNT(*) as total
      FROM ordered
      WHERE (open - prev_close) >= ${thresh}
        AND (epoch - prev_epoch) = 60;
    `;
    const res = await client.query(q);
    console.log(`M1 Gap consecutivo (open - prev_close >= ${thresh} pts): ${res.rows[0].total}`);
  }

  // 2. Gaps M5 (Open vs Prev Close)
  for (const thresh of [1.0, 2.0, 3.0, 5.0, 10.0]) {
    const q = `
      WITH ordered AS (
        SELECT epoch, open, high, low, close,
               LAG(close) OVER (ORDER BY epoch) as prev_close,
               LAG(epoch) OVER (ORDER BY epoch) as prev_epoch
        FROM candles
        WHERE symbol = 'BOOM600' AND granularity = 300
          AND epoch >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '30 days'))
      )
      SELECT COUNT(*) as total
      FROM ordered
      WHERE (open - prev_close) >= ${thresh}
        AND (epoch - prev_epoch) = 300;
    `;
    const res = await client.query(q);
    console.log(`M5 Gap consecutivo (open - prev_close >= ${thresh} pts): ${res.rows[0].total}`);
  }

  // 3. Fair Value Gaps (FVG) en M1: Low[i] > High[i-2]
  const fvgM1Query = `
    WITH ordered AS (
      SELECT epoch, open, high, low, close,
             LAG(high, 2) OVER (ORDER BY epoch) as lag2_high,
             LAG(epoch, 2) OVER (ORDER BY epoch) as lag2_epoch
      FROM candles
      WHERE symbol = 'BOOM600' AND granularity = 60
        AND epoch >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '30 days'))
    )
    SELECT COUNT(*) as total
    FROM ordered
    WHERE low > lag2_high
      AND (low - lag2_high) >= 1.0
      AND (epoch - lag2_epoch) = 120;
  `;
  const fvgM1 = await client.query(fvgM1Query);
  console.log(`M1 Fair Value Gaps (FVG >= 1.0 pts): ${fvgM1.rows[0].total}`);

  // 4. Fair Value Gaps (FVG) en M5: Low[i] > High[i-2]
  const fvgM5Query = `
    WITH ordered AS (
      SELECT epoch, open, high, low, close,
             LAG(high, 2) OVER (ORDER BY epoch) as lag2_high,
             LAG(epoch, 2) OVER (ORDER BY epoch) as lag2_epoch
      FROM candles
      WHERE symbol = 'BOOM600' AND granularity = 300
        AND epoch >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '30 days'))
    )
    SELECT COUNT(*) as total
    FROM ordered
    WHERE low > lag2_high
      AND (low - lag2_high) >= 2.0
      AND (epoch - lag2_epoch) = 600;
  `;
  const fvgM5 = await client.query(fvgM5Query);
  console.log(`M5 Fair Value Gaps (FVG >= 2.0 pts): ${fvgM5.rows[0].total}`);

  // 5. Muestra de los gaps M1 más significativos
  const sampleQ = `
    WITH ordered AS (
      SELECT epoch, open, high, low, close,
             LAG(close) OVER (ORDER BY epoch) as prev_close,
             LAG(epoch) OVER (ORDER BY epoch) as prev_epoch
      FROM candles
      WHERE symbol = 'BOOM600' AND granularity = 60
        AND epoch >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '30 days'))
    )
    SELECT epoch, to_timestamp(epoch) as fecha, prev_close, open,
           ROUND((open - prev_close)::numeric, 3) as gap_pts
    FROM ordered
    WHERE (open - prev_close) >= 2.0
      AND (epoch - prev_epoch) = 60
    ORDER BY epoch DESC
    LIMIT 10;
  `;
  const sample = await client.query(sampleQ);
  console.log('\nMuestra de 10 Gaps M1 recientes (>= 2.0 pts):');
  console.table(sample.rows);

  await client.end();
}

check().catch(console.error);
