-- cleanup_candles.sql
-- Uso: revisar las consultas primero. Hacer BACKUP antes de ejecutar.
-- 1) Vista previa de buckets con más de 1 fila
SELECT
  symbol,
  granularity,
  (epoch / granularity) * granularity AS bucket_epoch,
  COUNT(*) AS cnt,
  MIN(epoch) AS min_epoch,
  MAX(epoch) AS max_epoch
FROM candles
GROUP BY symbol, granularity, bucket_epoch
HAVING COUNT(*) > 1
ORDER BY symbol, granularity, bucket_epoch
LIMIT 500;

-- ---------------------------------------------------
-- Opción A (no destructiva): eliminar duplicados conservando la fila más reciente por bucket
-- (Recomendado si no quieres recomputar OHLC)
-- Ejecutar dentro de una transacción si lo deseas.
BEGIN;
WITH to_keep AS (
  SELECT DISTINCT ON (symbol, granularity, (epoch / granularity) * granularity)
    id
  FROM candles
  ORDER BY symbol, granularity, (epoch / granularity) * granularity, "createdAt" DESC
)
DELETE FROM candles
WHERE id NOT IN (SELECT id FROM to_keep);
COMMIT;

-- ---------------------------------------------------
-- Opción B (reconstruir por bucket agregando OHLC): más segura para asegurar vela por bucket correcta
-- Requiere extension pgcrypto para gen_random_uuid(); alterna con uuid_generate_v4() si la tienes.
-- 0) Hacer backup completo
CREATE TABLE IF NOT EXISTS candles_backup AS TABLE candles;

-- 1) Crear tabla temporal con agregados por bucket
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS candles_aggregated_tmp;
CREATE TABLE candles_aggregated_tmp AS
WITH aggregated AS (
  SELECT
    symbol,
    granularity,
    (epoch / granularity) * granularity AS epoch,
    (array_agg(open ORDER BY epoch))[1]       AS open,
    MAX(high)                                 AS high,
    MIN(low)                                  AS low,
    (array_agg(close ORDER BY epoch DESC))[1]  AS close,
    MAX("createdAt")                         AS "createdAt"
  FROM candles
  GROUP BY symbol, granularity, (epoch / granularity) * granularity
)
SELECT
  gen_random_uuid() AS id,
  symbol,
  granularity,
  epoch,
  open,
  high,
  low,
  close,
  "createdAt"
FROM aggregated;

-- 2) Revisar agregados antes de aplicar
SELECT * FROM candles_aggregated_tmp WHERE symbol = 'CRASH1000' ORDER BY epoch ASC LIMIT 200;

-- 3) Reemplazo (destructivo) - ejecutar solo si verificaste lo anterior
BEGIN;
TRUNCATE TABLE candles;
INSERT INTO candles (id, symbol, granularity, epoch, open, high, low, close, "createdAt")
SELECT id, symbol, granularity, epoch, open, high, low, close, "createdAt" FROM candles_aggregated_tmp;
COMMIT;

-- 4) Limpieza: eliminar tabla temporal si quieres
-- DROP TABLE candles_aggregated_tmp;

-- ---------------------------------------------------
-- Notas:
-- - Si tu tabla tiene constraints/serials o triggers, adapter las inserciones según corresponda.
-- - Siempre prueba primero la sección de vista previa y la de "SELECT * FROM candles_aggregated_tmp".
-- - En Windows con psql via PowerShell:
--   psql -h <host> -U <user> -d <db> -f backend\\db\\cleanup_candles.sql
-- - Haz un backup del dump completo si prefieres: pg_dump -h <host> -U <user> -d <db> -F c -b -v -f candles_backup.dump
