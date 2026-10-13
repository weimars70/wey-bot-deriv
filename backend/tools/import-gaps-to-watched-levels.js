const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Client } = require('pg');

// Configuración por defecto y lectura de argumentos
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const match = args.find((a) => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1] : fallback;
};
const isDryRun = args.includes('--dry-run') || args.includes('--dryRun');

const targetSymbol = (getArg('symbol', 'BOOM600')).toUpperCase();
const daysBack = parseInt(getArg('days', '30'), 10);
const minGapPoints = parseFloat(getArg('minGap', '1.5'));

function getSuggestedLot(symbol) {
  const s = symbol.toUpperCase().replace(/\s+/g, '');
  if (s.includes('CRASH600') || s.includes('CRASH900') || s.includes('BOOM600') || s.includes('BOOM900') || s.includes('BOOM1000')) {
    return 0.5;
  }
  return 1.0;
}

async function run() {
  const isBoom = targetSymbol.startsWith('BOOM');
  const direction = isBoom ? 'BUY' : 'SELL';
  const lot = getSuggestedLot(targetSymbol);

  console.log('════════════════════════════════════════════════════════════════');
  console.log(`🔎 BUSCADOR E IMPORTADOR DE GAPS A PUNTOS VIGILADOS`);
  console.log(`   Símbolo: ${targetSymbol} (${direction})`);
  console.log(`   Periodo: Últimos ${daysBack} días`);
  console.log(`   Salto mínimo (Gap): >= ${minGapPoints} puntos`);
  console.log(`   Lote asignado: ${lot}`);
  console.log(`   Modo: ${isDryRun ? 'DRY RUN (Solo simulación, sin insertar)' : 'INSERCIÓN REAL'}`);
  console.log('════════════════════════════════════════════════════════════════\n');

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: String(process.env.DB_PASSWORD || '').replace(/^['"]|['"]$/g, ''),
    database: process.env.DB_DATABASE,
  });

  await client.connect();

  // 1. Detección de Gaps en velas M1 (consecutivas epoch - prev_epoch = 60s)
  // En Boom: salto alcista de apertura (open - prev_close >= minGap)
  // En Crash: salto bajista de apertura (prev_close - open >= minGap)
  const gapCondition = isBoom
    ? `(open - prev_close) >= ${minGapPoints}`
    : `(prev_close - open) >= ${minGapPoints}`;

  const gapQuery = `
    WITH ordered AS (
      SELECT epoch, open, high, low, close,
             LAG(close) OVER (ORDER BY epoch) as prev_close,
             LAG(high) OVER (ORDER BY epoch) as prev_high,
             LAG(low) OVER (ORDER BY epoch) as prev_low,
             LAG(epoch) OVER (ORDER BY epoch) as prev_epoch
      FROM candles
      WHERE symbol = $1 AND granularity = 60
        AND epoch >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '${daysBack} days'))
    )
    SELECT epoch,
           to_timestamp(epoch) as fecha,
           ROUND(prev_close::numeric, 3) as prev_close,
           ROUND(open::numeric, 3) as open,
           ROUND(high::numeric, 3) as high,
           ROUND(low::numeric, 3) as low,
           ROUND(ABS(open - prev_close)::numeric, 3) as gap_pts
    FROM ordered
    WHERE ${gapCondition}
      AND (epoch - prev_epoch) = 60
    ORDER BY epoch ASC;
  `;

  const res = await client.query(gapQuery, [targetSymbol]);
  const gaps = res.rows;
  console.log(`📊 Total de Gaps detectados en velas M1: ${gaps.length}`);

  if (gaps.length === 0) {
    console.log('No se encontraron gaps con los parámetros indicados.');
    await client.end();
    return;
  }

  // 2. Consultar niveles ya existentes en watched_entry_levels para evitar duplicados
  const existingRes = await client.query(
    'SELECT "entryPrice", note, status FROM watched_entry_levels WHERE symbol = $1',
    [targetSymbol]
  );
  const existingPrices = existingRes.rows.map((r) => Number(r.entryPrice));
  console.log(`📌 Niveles existentes en watched_entry_levels para ${targetSymbol}: ${existingPrices.length}\n`);

  let insertedCount = 0;
  let skippedCount = 0;
  const insertRecords = [];

  for (const gap of gaps) {
    // En Boom, el retroceso bajista regresa hacia prev_close (el piso / origen del salto).
    // En Crash, el retroceso alcista regresa hacia prev_close (el techo / origen de la caída).
    const entryPrice = Number(gap.prev_close);
    const gapSize = Number(gap.gap_pts);
    const dateObj = new Date(gap.fecha);
    const dateStr = dateObj.toISOString().replace('T', ' ').slice(0, 16);

    // Evitar duplicados cercanos (< 0.3 puntos de un nivel ya existente o ya planeado)
    const alreadyExists = existingPrices.some((p) => Math.abs(p - entryPrice) < 0.3);
    const alreadyPlanned = insertRecords.some((r) => Math.abs(r.entryPrice - entryPrice) < 0.3);

    if (alreadyExists || alreadyPlanned) {
      skippedCount++;
      continue;
    }

    const note = `Gap M1 [${dateStr}] Base: ${entryPrice.toFixed(3)} -> Salto: ${Number(gap.open).toFixed(3)} (+${gapSize.toFixed(2)} pts)`;

    insertRecords.push({
      symbol: targetSymbol,
      direction,
      entryPrice,
      lot,
      multipleReactions: true,
      status: 'PENDING',
      note,
      fecha: dateStr,
      gapSize,
    });
  }

  console.log(`📋 Gaps únicos para registrar: ${insertRecords.length} (Omitidos por duplicado o proximidad <0.3 pts: ${skippedCount})\n`);

  // 3. Ejecutar inserts en watched_entry_levels
  if (!isDryRun && insertRecords.length > 0) {
    for (const item of insertRecords) {
      await client.query(
        `INSERT INTO watched_entry_levels
         (symbol, direction, "entryPrice", lot, "multipleReactions", status, note, backtesting, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, NOW(), NOW())`,
        [
          item.symbol,
          item.direction,
          item.entryPrice,
          item.lot,
          item.multipleReactions,
          item.status,
          item.note,
        ]
      );
      insertedCount++;
    }
  }

  // 4. Mostrar resumen y tabla con los niveles
  console.log('────────────────────────────────────────────────────────────────');
  console.log(`✅ RESULTADO:`);
  console.log(`   - Gaps detectados: ${gaps.length}`);
  console.log(`   - Gaps insertados en watched_entry_levels: ${isDryRun ? 0 : insertedCount}`);
  console.log(`   - Gaps omitidos por duplicado/cercanía: ${skippedCount}`);
  console.log('────────────────────────────────────────────────────────────────\n');

  console.log('Primeros 20 niveles registrados:');
  console.table(
    insertRecords.slice(0, 20).map((r, i) => ({
      '#': i + 1,
      Símbolo: r.symbol,
      Dirección: r.direction,
      'Punto Entrada': r.entryPrice,
      Lote: r.lot,
      'Salto Gap (pts)': r.gapSize,
      Fecha: r.fecha,
      Nota: r.note,
    }))
  );

  const totalLevels = await client.query(
    'SELECT count(*) as total FROM watched_entry_levels WHERE symbol = $1',
    [targetSymbol]
  );
  console.log(`\nTotal actual de puntos vigilados en BD para ${targetSymbol}: ${totalLevels.rows[0].total}`);

  await client.end();
}

run().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
