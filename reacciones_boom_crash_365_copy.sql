BEGIN;

TRUNCATE TABLE watched_entry_levels;

CREATE TABLE IF NOT EXISTS watched_entry_levels_stage (
  indice text,
  tipo_reaccion text,
  nivel_central double precision,
  zona_desde double precision,
  zona_hasta double precision,
  ancho_zona_puntos double precision,
  numero_reacciones integer,
  primera_reaccion text,
  ultima_reaccion text,
  precio_minimo_detectado double precision,
  precio_maximo_detectado double precision,
  rebote_maximo_puntos double precision,
  timeframe text,
  dias_analizados integer,
  distancia_maxima_puntos integer,
  rebote_minimo_puntos integer
);

\copy watched_entry_levels_stage (
  indice,
  tipo_reaccion,
  nivel_central,
  zona_desde,
  zona_hasta,
  ancho_zona_puntos,
  numero_reacciones,
  primera_reaccion,
  ultima_reaccion,
  precio_minimo_detectado,
  precio_maximo_detectado,
  rebote_maximo_puntos,
  timeframe,
  dias_analizados,
  distancia_maxima_puntos,
  rebote_minimo_puntos
) FROM 'C:/Users/Weimar/Documents/proyectos/deriv-app/reacciones_boom_crash_365.csv' WITH (FORMAT csv, DELIMITER ';', HEADER true, ENCODING 'UTF8');

INSERT INTO watched_entry_levels (
  symbol,
  direction,
  "entryPrice",
  lot,
  "multipleReactions",
  status,
  note,
  backtesting,
  "createdAt",
  "updatedAt"
)
SELECT
  s.indice,
  CASE WHEN s.tipo_reaccion = 'BAJISTA' THEN 'SELL' ELSE 'BUY' END,
  s.nivel_central,
  1,
  CASE WHEN s.numero_reacciones > 1 THEN true ELSE false END,
  'PENDING',
  'CSV export: ' || s.indice || ' - ' || CASE WHEN s.tipo_reaccion = 'BAJISTA' THEN 'SELL' ELSE 'BUY' END || ' - reactions=' || s.numero_reacciones::text,
  true,
  NOW(),
  NOW()
FROM watched_entry_levels_stage s;

DROP TABLE watched_entry_levels_stage;

COMMIT;
