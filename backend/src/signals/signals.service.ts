import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CandlesService } from '../candles/candles.service';
import { DerivWebsocketService } from '../deriv/deriv-websocket.service';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SignalDirection = 'COMPRA' | 'VENTA' | 'NEUTRAL';
export type MtfAlignment = 'ALINEADO' | 'PARCIAL' | 'SIN ALINEACIÓN (MEZCLADO)';
export type SymbolClass = 'crash' | 'boom' | 'other';

export interface SignalResult {
  symbol: string;
  granularity: number;
  direction: SignalDirection;
  symbolClass: SymbolClass;
  stars: number; // 1-4
  entry: number;
  sl: number;
  tp: number;
  rb: number;
  recorrido: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  atr: number;
  alignment: MtfAlignment;
  alignmentDetail: Record<string, SignalDirection>;
  macroTrend: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL';
  macroTrendOk: boolean;
  macroTrendH4?: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL';
  macroTrendH4Ok?: boolean;
  structureOk: boolean;
  candlesSinceLastSpike: number;
  avgReactionCandles: number;
  recentSpikesCount?: number;
  pullbackPct?: number;
  inOrderBlockZone?: boolean;
  viable: boolean;
  viabilityReason: string;
  historyContext?: Record<string, TimeframeHistoryContext>;
  historicalReactionFrames?: number;
  insufficientData: boolean;
  computedAt: string;
}

export interface TimeframeHistoryContext {
  direction: SignalDirection;
  candlesAnalyzed: number;
  daysAnalyzed: number;
  reactionCount: number;
  recentReactionEpoch: number | null;
  recentReactionAgeHours: number | null;
  pricePositionPct: number;
}

// ─── Known crash/boom symbol codes ─────────────────────────────────────────
// The OTP trading endpoint does NOT support active_symbols, so we cannot
// discover symbols dynamically. Instead we maintain the known codes.
// Deriv uses 'N' suffix for some instruments — we try both variants;
// invalid symbols are silently rejected by the subscribeCandles error handler.
export const CRASH_BOOM_KNOWN_SYMBOLS: string[] = [
  // Crash indices activos
  'CRASH300N',  // Crash 300 Index
  'CRASH500',   // Crash 500 Index
  'CRASH600',   // Crash 600 Index
  'CRASH900',   // Crash 900 Index
  'CRASH1000',  // Crash 1000 Index
  // Boom indices activos
  'BOOM300N',   // Boom 300 Index
  'BOOM500',    // Boom 500 Index
  'BOOM600',    // Boom 600 Index
  'BOOM900',    // Boom 900 Index
  'BOOM1000',   // Boom 1000 Index
];

// ─── Symbol class helper ─────────────────────────────────────────────────────

function getSymbolClass(symbol: string): SymbolClass {
  if (!symbol) return 'other';
  const up = symbol.toUpperCase();
  if (up.includes('CRASH')) return 'crash';
  if (up.includes('BOOM'))  return 'boom';
  return 'other';
}

function isCrashOrBoom(symbol: string): boolean {
  return !!symbol && getSymbolClass(symbol) !== 'other';
}

// ─── Math helpers ────────────────────────────────────────────────────────────

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  result.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): { macd: number; signal: number; histogram: number } {
  if (closes.length < slow + signal) return { macd: 0, signal: 0, histogram: 0 };
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const offset = emaFast.length - emaSlow.length;
  const macdLine = emaSlow.map((v, i) => emaFast[i + offset] - v);
  const signalLine = ema(macdLine, signal);
  const last    = macdLine[macdLine.length - 1];
  const lastSig = signalLine[signalLine.length - 1];
  return { macd: last, signal: lastSig, histogram: last - lastSig };
}

function bollingerBands(
  closes: number[],
  period = 20,
  stdMult = 2,
): { upper: number; lower: number; mid: number } {
  const slice = closes.slice(-period);
  const mid = slice.reduce((s, v) => s + v, 0) / slice.length;
  const variance = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / slice.length;
  const std = Math.sqrt(variance);
  return { upper: mid + stdMult * std, lower: mid - stdMult * std, mid };
}

function atr(candles: { high: number; low: number; close: number }[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return trs.slice(-period).reduce((s, v) => s + v, 0) / Math.min(trs.length, period);
}

// ─── Benchmarks de Stop Loss para entradas con proyección (Swing / Largas) ─────
// En operativas con proyección, el SL no puede basarse en un puñado de velas M1
// (que provocan salidas prematuras por ruido). Cada índice tiene un margen técnico
// coherente con su volatilidad y rango intradía, alineado a los estándares de Apex/BotOld.
export function getProjectionSLBenchmark(symbol: string): { minSl: number; defaultSl: number; maxSl: number } {
  const up = (symbol ?? '').toUpperCase();
  if (up.includes('CRASH1000') || up.includes('BOOM1000')) {
    return { minSl: 18.0, defaultSl: 24.0, maxSl: 42.0 };
  }
  if (up.includes('CRASH900') || up.includes('BOOM900')) {
    return { minSl: 16.0, defaultSl: 22.0, maxSl: 38.0 };
  }
  if (up.includes('CRASH600') || up.includes('BOOM600')) {
    return { minSl: 12.0, defaultSl: 16.0, maxSl: 30.0 };
  }
  if (up.includes('CRASH500') || up.includes('BOOM500')) {
    return { minSl: 10.0, defaultSl: 14.0, maxSl: 25.0 };
  }
  if (up.includes('CRASH300') || up.includes('BOOM300')) {
    return { minSl: 7.0, defaultSl: 10.0, maxSl: 18.0 };
  }
  return { minSl: 15.0, defaultSl: 20.0, maxSl: 35.0 };
}

export function calcTypicalM1Size(
  candles: { open: number; high: number; low: number; close: number }[],
  atrVal: number,
): number {
  const windowCandles = candles.slice(-30);
  const candleSizes = windowCandles
    .map((c) => Math.max(c.high - c.low, Math.abs(c.close - c.open)))
    .filter((s) => s > 0);
  if (candleSizes.length > 0) {
    candleSizes.sort((a, b) => a - b);
    const mid = Math.floor(candleSizes.length / 2);
    const m = candleSizes.length % 2 !== 0 ? candleSizes[mid] : (candleSizes[mid - 1] + candleSizes[mid]) / 2;
    return m > 0.0001 ? m : atrVal > 0 ? atrVal : 1.0;
  }
  return atrVal > 0 ? atrVal : 1.0;
}

export interface ProjectionLevels {
  sl: number;
  tp: number;
  rb: number;
  recorrido: number;
  slDist: number;
  tpDist: number;
}

/**
 * Calcula niveles de SL y TP para ENTRADAS CON PROYECCIÓN (LARGAS):
 * 1. SL: Basado en el swing high/low estructural de M15 con buffer técnico,
 *    acotado por los márgenes de seguridad del índice (minSl / maxSl).
 * 2. TP: Basado en el soporte/resistencia mayor de H1 (últimas 24-72h) o
 *    extensión estructural de proyección con R/B amplio (mínimo 1:6 a 1:25).
 * 3. Recorrido: % de progreso del trayecto desde el origen de la estructura hasta el TP.
 */
export function calcLongProjectionLevels(
  symbol: string,
  direction: SignalDirection,
  entry: number,
  atrM1: number,
  m15Candles?: { high: number; low: number; close: number; open: number }[],
  h1Candles?: { high: number; low: number; close: number; open: number }[],
  m1Candles?: { high: number; low: number; close: number; open: number }[],
  h4Candles?: { high: number; low: number; close: number; open: number }[],
): ProjectionLevels {
  const symClass = getSymbolClass(symbol);
  const bench = getProjectionSLBenchmark(symbol);

  // 1. Cálculo de SL Estructural con Proyección
  let slDist = bench.defaultSl;

  if (symClass === 'crash' || direction === 'VENTA') {
    if (m15Candles && m15Candles.length >= 4) {
      const recentM15Highs = m15Candles.slice(-12).map((c) => c.high);
      const swingHigh = Math.max(...recentM15Highs);
      const buffer = Math.max(bench.defaultSl * 0.15, atrM1 * 2);
      const candidateDist = swingHigh + buffer - entry;
      slDist = Math.max(bench.minSl, Math.min(bench.maxSl, candidateDist));
    }
  } else if (symClass === 'boom' || direction === 'COMPRA') {
    if (m15Candles && m15Candles.length >= 4) {
      const recentM15Lows = m15Candles.slice(-12).map((c) => c.low);
      const swingLow = Math.min(...recentM15Lows);
      const buffer = Math.max(bench.defaultSl * 0.15, atrM1 * 2);
      const candidateDist = entry - (swingLow - buffer);
      slDist = Math.max(bench.minSl, Math.min(bench.maxSl, candidateDist));
    }
  }

  const sl = direction === 'VENTA' ? entry + slDist : entry - slDist;

  // 2. Cálculo de TP con Proyección Larga (H4 / H1 Estructural)
  const minProjectionRatio = 6.0;   // Mínimo R/B 1:6 para considerar proyección larga
  const maxProjectionRatio = 25.0;  // Máximo R/B razonable
  const defaultProjectionRatio = 9.0; // Ratio objetivo estándar de proyección

  let tpDist = slDist * defaultProjectionRatio;

  if (symClass === 'crash' || direction === 'VENTA') {
    if (h4Candles && h4Candles.length >= 6) {
      const h4Lows = h4Candles.slice(-30).map((c) => c.low);
      const majorSupport4H = Math.min(...h4Lows);
      const structuralDist = entry - majorSupport4H;
      if (structuralDist >= slDist * minProjectionRatio && structuralDist <= slDist * maxProjectionRatio) {
        tpDist = structuralDist;
      } else if (structuralDist > slDist * maxProjectionRatio) {
        tpDist = slDist * 14.0;
      }
    } else if (h1Candles && h1Candles.length >= 6) {
      const h1Lows = h1Candles.slice(-72).map((c) => c.low);
      const majorSupport = Math.min(...h1Lows);
      const structuralDist = entry - majorSupport;

      if (structuralDist >= slDist * minProjectionRatio && structuralDist <= slDist * maxProjectionRatio) {
        tpDist = structuralDist;
      } else if (structuralDist > slDist * maxProjectionRatio) {
        tpDist = slDist * 14.0;
      } else {
        tpDist = slDist * 10.0;
      }
    } else if (m15Candles && m15Candles.length >= 8) {
      const m15Lows = m15Candles.slice(-32).map((c) => c.low);
      const majorSupport = Math.min(...m15Lows);
      const structuralDist = entry - majorSupport;
      if (structuralDist >= slDist * minProjectionRatio) {
        tpDist = Math.min(slDist * maxProjectionRatio, structuralDist);
      }
    }
  } else if (symClass === 'boom' || direction === 'COMPRA') {
    if (h4Candles && h4Candles.length >= 6) {
      const h4Highs = h4Candles.slice(-30).map((c) => c.high);
      const majorRes4H = Math.max(...h4Highs);
      const structuralDist = majorRes4H - entry;
      if (structuralDist >= slDist * minProjectionRatio && structuralDist <= slDist * maxProjectionRatio) {
        tpDist = structuralDist;
      } else if (structuralDist > slDist * maxProjectionRatio) {
        tpDist = slDist * 14.0;
      }
    } else if (h1Candles && h1Candles.length >= 6) {
      const h1Highs = h1Candles.slice(-72).map((c) => c.high);
      const majorResistance = Math.max(...h1Highs);
      const structuralDist = majorResistance - entry;

      if (structuralDist >= slDist * minProjectionRatio && structuralDist <= slDist * maxProjectionRatio) {
        tpDist = structuralDist;
      } else if (structuralDist > slDist * maxProjectionRatio) {
        tpDist = slDist * 14.0;
      } else {
        tpDist = slDist * 10.0;
      }
    } else if (m15Candles && m15Candles.length >= 8) {
      const m15Highs = m15Candles.slice(-32).map((c) => c.high);
      const majorResistance = Math.max(...m15Highs);
      const structuralDist = majorResistance - entry;
      if (structuralDist >= slDist * minProjectionRatio) {
        tpDist = Math.min(slDist * maxProjectionRatio, structuralDist);
      }
    }
  }

  const tp = direction === 'VENTA' ? entry - tpDist : entry + tpDist;
  const rb = parseFloat((tpDist / slDist).toFixed(1));

  // 3. Recorrido (%)
  let recorrido = 0;
  if (symClass === 'crash' || direction === 'VENTA') {
    const originCandles = m15Candles && m15Candles.length > 0 ? m15Candles : m1Candles || [];
    const originHigh = originCandles.length > 0 ? Math.max(...originCandles.slice(-16).map((c) => c.high)) : entry + slDist;
    const totalSpan = originHigh - tp;
    const traveled = Math.max(0, originHigh - entry);
    recorrido = totalSpan > 0 ? Math.min(100, Math.max(0, Math.round((traveled / totalSpan) * 100))) : 0;
  } else {
    const originCandles = m15Candles && m15Candles.length > 0 ? m15Candles : m1Candles || [];
    const originLow = originCandles.length > 0 ? Math.min(...originCandles.slice(-16).map((c) => c.low)) : entry - slDist;
    const totalSpan = tp - originLow;
    const traveled = Math.max(0, entry - originLow);
    recorrido = totalSpan > 0 ? Math.min(100, Math.max(0, Math.round((traveled / totalSpan) * 100))) : 0;
  }

  return {
    sl: parseFloat(sl.toFixed(4)),
    tp: parseFloat(tp.toFixed(4)),
    rb,
    recorrido,
    slDist,
    tpDist,
  };
}

// ─── Estadísticas de Reacción y Spikes ───────────────────────────────────────

export function getSpikeBenchmark(symbol: string): number {
  const up = (symbol ?? '').toUpperCase();
  if (up.includes('300')) return 5;
  if (up.includes('500')) return 8;
  if (up.includes('600')) return 10;
  if (up.includes('900')) return 15;
  if (up.includes('1000')) return 16;
  return 10;
}

function calcSpikeStats(
  candles: { open: number; high: number; low: number; close: number }[],
  direction: 'CRASH' | 'BOOM' | 'OTHER',
  typicalM1Size: number,
): {
  candlesSinceLastSpike: number;
  lastSpikeIdx: number;
  recentSpikesCount: number;
  pullbackPct: number;
  inOrderBlockZone: boolean;
  obInvalidated: boolean;
} {
  if (candles.length === 0) {
    return {
      candlesSinceLastSpike: 0,
      lastSpikeIdx: -1,
      recentSpikesCount: 0,
      pullbackPct: 0,
      inOrderBlockZone: false,
      obInvalidated: false,
    };
  }

  // Un spike institucional en Crash/Boom mide al menos 2.3 veces la vela normal de acumulación
  const spikeThreshold = Math.max(typicalM1Size * 2.3, 0.001);
  let lastSpikeIdx = -1;
  let recentSpikesCount = 0;
  // Ventana de 3 horas en 5M (36 velas) para medir frecuencia activa de reacción
  const recentWindowStart = Math.max(0, candles.length - 36);

  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    let isSpike = false;
    if (direction === 'CRASH') {
      const drop = c.open - c.close;
      if (drop >= spikeThreshold) isSpike = true;
    } else if (direction === 'BOOM') {
      const jump = c.close - c.open;
      if (jump >= spikeThreshold) isSpike = true;
    } else {
      const range = c.high - c.low;
      if (range >= spikeThreshold * 2) isSpike = true;
    }

    if (isSpike) {
      if (lastSpikeIdx === -1) lastSpikeIdx = i;
      if (i >= recentWindowStart) recentSpikesCount++;
    }
  }

  const candlesSinceLastSpike =
    lastSpikeIdx >= 0 ? candles.length - 1 - lastSpikeIdx : candles.length;

  // Evaluar retroceso (Pullback) hacia el Order Block del último impulso/spike
  let pullbackPct = 0;
  let inOrderBlockZone = false;
  let obInvalidated = false;
  const currentPrice = candles[candles.length - 1].close;

  if (lastSpikeIdx >= 0) {
    const spikeCandle = candles[lastSpikeIdx];
    const prevCandle = lastSpikeIdx > 0 ? candles[lastSpikeIdx - 1] : spikeCandle;

    if (direction === 'CRASH') {
      // Techo de origen del spike (Order Block bajista) y suelo alcanzado tras el spike
      const originHigh = Math.max(spikeCandle.high, prevCandle.high);
      const postSpikeLows = candles.slice(lastSpikeIdx).map((c) => c.low);
      const impulseLow = Math.min(spikeCandle.low, ...postSpikeLows);
      const impulseSpan = originHigh - impulseLow;

      if (impulseSpan > 0) {
        pullbackPct = Math.round(((currentPrice - impulseLow) / impulseSpan) * 100);
        // Zona institucional de venta (Order Block / Fibonacci 30% a 85% del spike)
        inOrderBlockZone = pullbackPct >= 30 && pullbackPct <= 85;
        // Si el precio supera el origen del spike + pequeño margen, la estructura bajista del spike falló
        obInvalidated = currentPrice > originHigh + typicalM1Size * 0.35;
      }
    } else if (direction === 'BOOM') {
      // Piso de origen del spike (Order Block alcista) y techo alcanzado tras el spike
      const originLow = Math.min(spikeCandle.low, prevCandle.low);
      const postSpikeHighs = candles.slice(lastSpikeIdx).map((c) => c.high);
      const impulseHigh = Math.max(spikeCandle.high, ...postSpikeHighs);
      const impulseSpan = impulseHigh - originLow;

      if (impulseSpan > 0) {
        pullbackPct = Math.round(((impulseHigh - currentPrice) / impulseSpan) * 100);
        // Zona institucional de compra (Order Block / Fibonacci 30% a 85% del spike)
        inOrderBlockZone = pullbackPct >= 30 && pullbackPct <= 85;
        // Si el precio perfora el origen del spike - pequeño margen, la estructura alcista del spike falló
        obInvalidated = currentPrice < originLow - typicalM1Size * 0.35;
      }
    }
  }

  return {
    candlesSinceLastSpike,
    lastSpikeIdx,
    recentSpikesCount,
    pullbackPct,
    inOrderBlockZone,
    obInvalidated,
  };
}

// ─── Core signal computation ─────────────────────────────────────────────────

function computeSignalFromCandles(
  rawCandles: { open: number; high: number; low: number; close: number; epoch: number }[],
  symbol: string,
  granularity: number,
): Omit<SignalResult, 'alignment' | 'alignmentDetail'> & { obInvalidated?: boolean } {
  const symClass = getSymbolClass(symbol);
  const benchmark = getSpikeBenchmark(symbol);

  const MIN_CANDLES = 15;
  if (rawCandles.length < MIN_CANDLES) {
    return {
      symbol,
      granularity,
      symbolClass: symClass,
      direction: symClass === 'crash' ? 'VENTA' : symClass === 'boom' ? 'COMPRA' : 'NEUTRAL',
      stars: 0,
      entry: rawCandles[rawCandles.length - 1]?.close ?? 0,
      sl: 0,
      tp: 0,
      rb: 0,
      recorrido: 0,
      rsi: 50,
      macd: 0,
      macdSignal: 0,
      atr: 0,
      macroTrend: 'NEUTRAL',
      macroTrendOk: false,
      structureOk: false,
      candlesSinceLastSpike: 0,
      avgReactionCandles: benchmark,
      recentSpikesCount: 0,
      pullbackPct: 0,
      inOrderBlockZone: false,
      obInvalidated: false,
      viable: false,
      viabilityReason: 'Datos insuficientes',
      insufficientData: true,
      computedAt: new Date().toISOString(),
    };
  }

  const sorted = [...rawCandles].sort((a, b) => a.epoch - b.epoch);
  const closes = sorted.map((c) => c.close);
  const entry  = closes[closes.length - 1];

  // ── Indicators ───────────────────────────────────────────────────────────
  const ema9  = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const lastEma9  = ema9[ema9.length - 1];
  const lastEma21 = ema21[ema21.length - 1];

  const rsiVal  = rsi(closes, 14);
  const macdVal = macd(closes, 12, 26, 9);
  const bb      = bollingerBands(closes, 20, 2);
  const atrVal  = atr(sorted, 14);

  // Bollinger position
  const bbRange  = bb.upper - bb.lower;
  const posInBB  = bbRange > 0 ? (entry - bb.lower) / bbRange : 0.5;

  // ── Estadísticas de Spikes y Order Block antes de puntuar estrellas ──────
  const typicalM1 = calcTypicalM1Size(sorted, atrVal);
  const spikeStats = calcSpikeStats(
    sorted,
    symClass === 'crash' ? 'CRASH' : symClass === 'boom' ? 'BOOM' : 'OTHER',
    typicalM1,
  );
  const {
    candlesSinceLastSpike,
    recentSpikesCount,
    pullbackPct,
    inOrderBlockZone,
    obInvalidated,
  } = spikeStats;

  // ── Confluence & Stars (Lógica Sniper: premia reacción activa + pullback a OB, castiga tendencia sin spikes) ──
  let direction: SignalDirection;
  let stars: number;

  if (symClass === 'crash') {
    direction = 'VENTA';
    let votes = 0;

    // 1. Frecuencia de spikes activa en las últimas 3h (el mercado SÍ está reaccionando)
    if (recentSpikesCount >= 2) votes++;
    if (recentSpikesCount >= 4) votes++;

    // 2. Precio en zona institucional de retroceso (Order Block 30%-85% del último spike) y sin invalidar techo
    if (inOrderBlockZone && !obInvalidated) votes += 2;

    // 3. Ventana óptima de enfriamiento (entre 2 velas y 1.15x la media del índice)
    if (candlesSinceLastSpike >= 2 && candlesSinceLastSpike <= Math.ceil(benchmark * 1.15)) {
      votes++;
    }

    // 4. RSI en zona de descuento saludable para recarga bajista (48-74), penalizando sobre-extensión alcista (>78)
    if (rsiVal >= 48 && rsiVal <= 74 && posInBB >= 0.40 && posInBB <= 0.88) {
      votes++;
    }

    stars = Math.min(4, Math.max(1, Math.round((votes / 6) * 4)));
  } else if (symClass === 'boom') {
    direction = 'COMPRA';
    let votes = 0;

    // 1. Frecuencia de spikes activa en las últimas 3h (el mercado SÍ está reaccionando)
    if (recentSpikesCount >= 2) votes++;
    if (recentSpikesCount >= 4) votes++;

    // 2. Precio en zona institucional de retroceso (Order Block 30%-85% del último spike) y sin invalidar piso
    if (inOrderBlockZone && !obInvalidated) votes += 2;

    // 3. Ventana óptima de enfriamiento (entre 2 velas y 1.15x la media del índice)
    if (candlesSinceLastSpike >= 2 && candlesSinceLastSpike <= Math.ceil(benchmark * 1.15)) {
      votes++;
    }

    // 4. RSI en zona de descuento saludable para recarga alcista (26-52), penalizando sangrado bajista (<22)
    if (rsiVal >= 26 && rsiVal <= 52 && posInBB >= 0.12 && posInBB <= 0.60) {
      votes++;
    }

    stars = Math.min(4, Math.max(1, Math.round((votes / 6) * 4)));
  } else {
    direction = lastEma9 > lastEma21 ? 'COMPRA' : 'VENTA';
    stars = 2;
  }

  // ── SL y TP para entradas con proyección (Largas) ─────────────────────────
  const projLevels = calcLongProjectionLevels(symbol, direction, entry, atrVal, undefined, undefined, sorted);

  return {
    symbol,
    granularity,
    symbolClass: symClass,
    direction,
    stars,
    entry:      parseFloat(entry.toFixed(4)),
    sl:         projLevels.sl,
    tp:         projLevels.tp,
    rb:         projLevels.rb,
    recorrido:  projLevels.recorrido,
    rsi:        parseFloat(rsiVal.toFixed(2)),
    macd:       parseFloat(macdVal.macd.toFixed(6)),
    macdSignal: parseFloat(macdVal.signal.toFixed(6)),
    atr:        parseFloat(atrVal.toFixed(4)),
    macroTrend: 'NEUTRAL',
    macroTrendOk: true,
    structureOk: true,
    candlesSinceLastSpike,
    avgReactionCandles: benchmark,
    recentSpikesCount,
    pullbackPct,
    inOrderBlockZone,
    obInvalidated,
    viable: true,
    viabilityReason: 'Evaluando con M15',
    insufficientData: false,
    computedAt: new Date().toISOString(),
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

const HISTORY_DAYS = 90;
// Ventana estricta de reacción reciente: últimas 8 horas (en vez de 30 días)
const RECENT_REACTION_HOURS = 8;
const MTF_GRANULARITIES = [900, 1800, 3600, 14400];
const MTF_LABELS: Record<number, string> = { 900: '15m', 1800: '30m', 3600: '1h', 14400: '4h' };

function analyzeTimeframeHistory(
  rawCandles: { open: number; high: number; low: number; close: number; epoch: number }[],
  symbolClass: SymbolClass,
  currentPrice?: number,
): TimeframeHistoryContext {
  const cutoffEpoch = Math.floor(Date.now() / 1000) - HISTORY_DAYS * 86400;
  const candles = [...rawCandles]
    .filter((c) => Number(c.epoch) >= cutoffEpoch)
    .sort((a, b) => Number(a.epoch) - Number(b.epoch));

  if (candles.length < 6) {
    return {
      direction: 'NEUTRAL',
      candlesAnalyzed: candles.length,
      daysAnalyzed: 0,
      reactionCount: 0,
      recentReactionEpoch: null,
      recentReactionAgeHours: null,
      pricePositionPct: 50,
    };
  }

  const closes = candles.map((c) => Number(c.close));
  if (currentPrice !== undefined && Number.isFinite(currentPrice) && currentPrice > 0) {
    closes[closes.length - 1] = currentPrice;
  }

  const fastPeriod = Math.min(9, Math.max(3, Math.floor(closes.length / 4)));
  const slowPeriod = Math.min(21, Math.max(fastPeriod + 2, Math.floor(closes.length / 2)));
  const fastSeries = ema(closes, fastPeriod);
  const slowSeries = ema(closes, slowPeriod);
  const fast = fastSeries[fastSeries.length - 1];
  const prevFast = fastSeries.length >= 2 ? fastSeries[fastSeries.length - 2] : fast;
  const slow = slowSeries[slowSeries.length - 1];
  const prevSlow = slowSeries.length >= 3 ? slowSeries[slowSeries.length - 3] : slow;
  const lastPrice = closes[closes.length - 1];

  let direction: SignalDirection = 'NEUTRAL';
  if (symbolClass === 'boom') {
    // Para BOOM (COMPRA): exigir estructura alcista real (EMA rápida >= EMA lenta, pendiente >= 0 y precio sostenido)
    if (lastPrice < slow || (lastPrice < fast && fast < prevFast) || slow < prevSlow) {
      direction = 'VENTA';
    } else if (fast >= slow && lastPrice >= slow) {
      direction = 'COMPRA';
    } else {
      direction = 'VENTA';
    }
  } else if (symbolClass === 'crash') {
    // Para CRASH (VENTA): exigir estructura bajista real (EMA rápida <= EMA lenta, pendiente <= 0 y precio bajo EMA lenta)
    if (lastPrice > slow || (lastPrice > fast && fast > prevFast) || slow > prevSlow) {
      direction = 'COMPRA';
    } else if (fast <= slow && lastPrice <= slow) {
      direction = 'VENTA';
    } else {
      direction = 'COMPRA';
    }
  } else {
    direction = fast > slow ? 'COMPRA' : fast < slow ? 'VENTA' : 'NEUTRAL';
  }

  const ranges = candles
    .map((c) => Math.max(0, Number(c.high) - Number(c.low)))
    .filter((range) => range > 0)
    .sort((a, b) => a - b);
  const typicalRange = ranges[Math.floor(ranges.length * 0.6)] || 0;
  // Umbral más exigente (1.55x el rango típico) para contar solo reacciones institucionales reales
  const reactionThreshold = typicalRange * 1.55;

  let reactionCount = 0;
  let recentReactionEpoch: number | null = null;
  for (const candle of candles) {
    const directionalMove = symbolClass === 'crash'
      ? Number(candle.open) - Number(candle.close)
      : Number(candle.close) - Number(candle.open);
    if (reactionThreshold > 0 && directionalMove >= reactionThreshold) {
      reactionCount++;
      recentReactionEpoch = Number(candle.epoch);
    }
  }

  // Posición del precio en el rango estructural reciente (últimas 48 velas del marco temporal)
  const recentWindow = candles.slice(-48);
  const firstEpoch = Number(candles[0].epoch);
  const lastEpoch = Number(candles[candles.length - 1].epoch);
  const minPrice = Math.min(...recentWindow.map((c) => Number(c.low)));
  const maxPrice = Math.max(...recentWindow.map((c) => Number(c.high)));
  const priceRange = maxPrice - minPrice;
  const pricePositionPct = priceRange > 0
    ? ((closes[closes.length - 1] - minPrice) / priceRange) * 100
    : 50;

  return {
    direction,
    candlesAnalyzed: candles.length,
    daysAnalyzed: Number(((lastEpoch - firstEpoch) / 86400).toFixed(1)),
    reactionCount,
    recentReactionEpoch,
    recentReactionAgeHours: recentReactionEpoch
      ? Number(((Date.now() / 1000 - recentReactionEpoch) / 3600).toFixed(1))
      : null,
    pricePositionPct: Number(pricePositionPct.toFixed(1)),
  };
}

@Injectable()
export class SignalsService implements OnModuleInit {
  private readonly logger = new Logger(SignalsService.name);
  private readonly historyBackfillScheduled = new Set<string>();
  private historyBackfillQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly candlesService: CandlesService,
    private readonly derivWs: DerivWebsocketService,
  ) {}

  onModuleInit() {
    // Will be triggered via deriv.authorize event instead;
    // this hook exists in case we need eager initialization later.
  }

  private scheduleHistoryBackfill(
    symbol: string,
    granularity: number,
    currentCandles: { epoch: number }[],
    targetCount: number,
  ) {
    const uniqueEpochs = new Set(currentCandles.map((c) => Number(c.epoch)));
    if (uniqueEpochs.size >= targetCount || uniqueEpochs.size === 0) return;

    const key = `${symbol}:${granularity}`;
    if (this.historyBackfillScheduled.has(key)) return;
    this.historyBackfillScheduled.add(key);

    const oldestStoredEpoch = Math.min(...uniqueEpochs);
    this.historyBackfillQueue = this.historyBackfillQueue
      .then(async () => {
        let remaining = targetCount - uniqueEpochs.size;
        let endEpoch = oldestStoredEpoch - 1;

        while (remaining > 0) {
          const count = Math.min(1000, remaining);
          const response = await this.derivWs.getCandlesHistory(
            symbol,
            granularity,
            count,
            endEpoch,
          );
          const batch = Array.isArray(response?.candles) ? response.candles : [];
          if (!batch.length) break;

          const oldestBatchEpoch = Math.min(...batch.map((c: any) => Number(c.epoch)));
          if (!Number.isFinite(oldestBatchEpoch) || oldestBatchEpoch > endEpoch) break;

          remaining -= batch.length;
          endEpoch = oldestBatchEpoch - 1;
          await new Promise((resolve) => setTimeout(resolve, 900));
        }

        this.logger.log(
          `Historial macro solicitado para ${symbol}@${granularity}s (objetivo ${targetCount} velas)`,
        );
      })
      .catch((error) => {
        this.historyBackfillScheduled.delete(key);
        this.logger.warn(
          `No se pudo completar historial ${symbol}@${granularity}s: ${error?.message ?? error}`,
        );
      });
  }

  /** Auto-suscribe todos los crash/boom en cuanto el WS se autoriza.
   *  Esto resuelve el caso de reinicio del backend: los Sets en memoria
   *  se vacían, pero aquí volvemos a suscribir automáticamente. */
  @OnEvent('deriv.authorize')
  async onDerivAuthorized() {
    this.logger.log('🎯 Auto-suscribiendo índices Crash/Boom...');
    try {
      const result = await this.subscribeTargetSymbols();
      this.logger.log(`✅ Suscritos: ${result.subscribed.join(', ')}`);
    } catch (e) {
      this.logger.warn(`No se pudo auto-suscribir crash/boom: ${e?.message ?? e}`);
    }
  }

  async getSignal(symbol: string, granularity = 300): Promise<SignalResult> {
    const raw = await this.candlesService.findLatest(symbol, granularity, 300);
    const base = computeSignalFromCandles(raw, symbol, granularity);

    // ── Contexto macro real: 15M / 30M / 1H / 4H, hasta 90 días ─────────────
    let mtf15Raw: { open: number; high: number; low: number; close: number; epoch: number }[] = [];
    let mtfH1Raw: { open: number; high: number; low: number; close: number; epoch: number }[] = [];
    let mtfH4Raw: { open: number; high: number; low: number; close: number; epoch: number }[] = [];

    const mtfResults: { label: string; context: TimeframeHistoryContext }[] = [];
    for (const g of MTF_GRANULARITIES) {
      const historyLimit = Math.min(300, Math.ceil((HISTORY_DAYS * 86400) / g) + 2);
      const mtfRaw = g === granularity
        ? raw
        : await this.candlesService.findLatest(symbol, g, historyLimit);
      this.scheduleHistoryBackfill(symbol, g, mtfRaw, historyLimit);
      if (g === 900) {
        mtf15Raw = mtfRaw;
      } else if (g === 3600) {
        mtfH1Raw = mtfRaw;
      } else if (g === 14400) {
        mtfH4Raw = mtfRaw;
      }
      const label = MTF_LABELS[g] ?? `${g}s`;
      const context = analyzeTimeframeHistory(mtfRaw, base.symbolClass, base.entry);
      mtfResults.push({ label, context });
    }

    const alignmentDetail: Record<string, SignalDirection> = {};
    const historyContext: Record<string, TimeframeHistoryContext> = {};
    let matchCount = 0;

    for (const { label, context } of mtfResults) {
      alignmentDetail[label] = context.direction;
      historyContext[label] = context;
      if (context.direction === base.direction) matchCount++;
    }

    // Ventana estricta de reacción reciente: 8h para 15m/30m/1h y 16h para 4h
    const historicalReactionFrames = Object.entries(historyContext).filter(([tf, context]) => {
      if (context.recentReactionAgeHours === null) return false;
      const maxHours = tf === '4h' ? RECENT_REACTION_HOURS * 2 : RECENT_REACTION_HOURS;
      return context.recentReactionAgeHours <= maxHours;
    }).length;

    let alignment: MtfAlignment;
    let stars = base.stars;

    if (matchCount === 4) {
      alignment = 'ALINEADO';
    } else if (matchCount >= 2) {
      alignment = 'PARCIAL';
    } else {
      alignment = 'SIN ALINEACIÓN (MEZCLADO)';
    }

    // ── Tendencia Macro 4H (EMA 21 + Pendiente) ─────────────────────────────
    let macroTrendH4: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL' = 'NEUTRAL';
    let macroTrendH4Ok = true;

    if (mtfH4Raw.length >= 6) {
      const sortedH4 = [...mtfH4Raw].sort((a, b) => a.epoch - b.epoch);
      const closesH4 = sortedH4.map((c) => c.close);
      const periodH4 = Math.min(21, Math.max(4, Math.floor(closesH4.length * 0.8)));
      const emaH4Series = ema(closesH4, periodH4);
      const emaH4 = emaH4Series[emaH4Series.length - 1];
      const emaH4Prev = emaH4Series.length >= 3 ? emaH4Series[emaH4Series.length - 3] : emaH4;
      const lastH4Close = closesH4[closesH4.length - 1];
      const refPriceH4 = base.entry > 0 ? base.entry : lastH4Close;

      if (base.symbolClass === 'crash') {
        macroTrendH4 = refPriceH4 < emaH4 && emaH4 <= emaH4Prev * 1.0002 ? 'BAJISTA' : 'ALCISTA';
        macroTrendH4Ok = macroTrendH4 === 'BAJISTA';
      } else if (base.symbolClass === 'boom') {
        macroTrendH4 = refPriceH4 > emaH4 && emaH4 >= emaH4Prev * 0.9998 ? 'ALCISTA' : 'BAJISTA';
        macroTrendH4Ok = macroTrendH4 === 'ALCISTA';
      } else {
        macroTrendH4 = refPriceH4 > emaH4 ? 'ALCISTA' : 'BAJISTA';
        macroTrendH4Ok = base.direction === 'COMPRA' ? macroTrendH4 === 'ALCISTA' : macroTrendH4 === 'BAJISTA';
      }
    }

    // ── Tendencia Intermedia M15 (EMA 50 + EMA 21 + Pendiente) y Estructura Real ──
    let macroTrend: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL' = 'NEUTRAL';
    let macroTrendOk = true;
    let structureOk = true;
    let structureReason = '';

    if (mtf15Raw.length >= 12) {
      const sorted15 = [...mtf15Raw].sort((a, b) => a.epoch - b.epoch);
      const closes15 = sorted15.map((c) => c.close);
      const period15 = Math.min(50, Math.max(10, Math.floor(closes15.length * 0.8)));
      const ema50Series = ema(closes15, period15);
      const ema21Series = ema(closes15, Math.min(21, Math.max(5, Math.floor(closes15.length * 0.5))));
      const ema50 = ema50Series[ema50Series.length - 1];
      const ema50Prev = ema50Series.length >= 3 ? ema50Series[ema50Series.length - 3] : ema50;
      const ema21_15 = ema21Series[ema21Series.length - 1];
      const last15Close = closes15[closes15.length - 1];
      const refPrice15 = base.entry > 0 ? base.entry : last15Close;

      if (base.symbolClass === 'crash') {
        macroTrend = refPrice15 < ema50 && ema21_15 <= ema50 && ema50 <= ema50Prev * 1.0001 ? 'BAJISTA' : 'ALCISTA';
        macroTrendOk = macroTrend === 'BAJISTA';
      } else if (base.symbolClass === 'boom') {
        macroTrend = refPrice15 > ema50 && ema21_15 >= ema50 && ema50 >= ema50Prev * 0.9999 ? 'ALCISTA' : 'BAJISTA';
        macroTrendOk = macroTrend === 'ALCISTA';
      } else {
        macroTrend = refPrice15 > ema50 ? 'ALCISTA' : 'BAJISTA';
        macroTrendOk = base.direction === 'COMPRA' ? macroTrend === 'ALCISTA' : macroTrend === 'BAJISTA';
      }

      // Estructura Real de Mercado en M15: comparar bloque previo vs bloque reciente (Lower Highs en Crash / Higher Lows en Boom)
      const prevBlock15 = sorted15.slice(-14, -5);
      const recentBlock15 = sorted15.slice(-5);
      const prevMaxHigh15 = Math.max(...prevBlock15.map((c) => c.high));
      const prevMinLow15  = Math.min(...prevBlock15.map((c) => c.low));
      const recentMaxHigh15 = Math.max(...recentBlock15.map((c) => c.high));
      const recentMinLow15  = Math.min(...recentBlock15.map((c) => c.low));

      if (base.symbolClass === 'crash') {
        // En Crash: exigir Máximos Decrecientes (Lower Highs) y que el Order Block 5M no esté invalidado
        if (base.obInvalidated) {
          structureOk = false;
          structureReason = 'Order Block 5M invalidado (precio superó origen del último spike)';
        } else if (recentMaxHigh15 > prevMaxHigh15 || base.entry >= recentMaxHigh15) {
          structureOk = false;
          structureReason = 'Estructura M15 rompió máximo previo (sin Lower Highs)';
        }
      } else if (base.symbolClass === 'boom') {
        // En Boom: exigir Mínimos Crecientes (Higher Lows) y que el Order Block 5M no esté invalidado
        if (base.obInvalidated) {
          structureOk = false;
          structureReason = 'Order Block 5M invalidado (precio perforó origen del último spike)';
        } else if (recentMinLow15 < prevMinLow15 || base.entry <= recentMinLow15) {
          structureOk = false;
          structureReason = 'Estructura M15 perforó mínimo previo (sin Higher Lows)';
        }
      }
    }

    // ── SL y TP para ENTRADAS CON PROYECCIÓN (LARGAS) usando H4, H1 y M15 ──
    const projection = calcLongProjectionLevels(
      symbol,
      base.direction,
      base.entry,
      base.atr,
      mtf15Raw,
      mtfH1Raw,
      raw,
      mtfH4Raw,
    );

    const maxReactionWindow = Math.max(6, Math.round(base.avgReactionCandles * 1.25));
    const coreTimeframesAligned =
      alignmentDetail['4h'] === base.direction &&
      alignmentDetail['1h'] === base.direction &&
      alignmentDetail['15m'] === base.direction;

    const pos1h = historyContext['1h']?.pricePositionPct ?? 50;
    const extremeZoneConflict =
      (base.symbolClass === 'crash' && pos1h < 18) ||
      (base.symbolClass === 'boom' && pos1h > 82);

    // ── Viabilidad Confluente Estricta ("Modo Sniper") ──────────────────────
    let viable = true;
    let viabilityReason = 'Confluencia 4H/1H/30M/15M favorable';

    if (base.insufficientData) {
      viable = false;
      viabilityReason = 'Datos insuficientes';
    } else if ((base.recentSpikesCount ?? 0) < 2) {
      viable = false;
      viabilityReason = `Mercado frío (${base.recentSpikesCount ?? 0} spikes en últimas 3h, mín 2)`;
    } else if (base.candlesSinceLastSpike < 2) {
      viable = false;
      viabilityReason = `Enfriamiento post-spike (${base.candlesSinceLastSpike}v 5M tras spike, mín 2 para pullback)`;
    } else if (base.candlesSinceLastSpike > maxReactionWindow) {
      viable = false;
      viabilityReason = `Sin reacción activa (${base.candlesSinceLastSpike}v 5M sin spike, máx ${maxReactionWindow}v)`;
    } else if (!base.inOrderBlockZone) {
      viable = false;
      viabilityReason = `Fuera de zona Order Block/Pullback (${base.pullbackPct ?? 0}%, requiere 30%–85% del último spike)`;
    } else if (!macroTrendH4Ok && mtfH4Raw.length >= 6) {
      viable = false;
      viabilityReason = `Contra tendencia 4H (${macroTrendH4} o pendiente adversa)`;
    } else if (!macroTrendOk && mtf15Raw.length >= 12) {
      viable = false;
      viabilityReason = `Contra tendencia M15 (${macroTrend}, requiere EMA21 y precio alineados con EMA50)`;
    } else if (!coreTimeframesAligned || matchCount < 3) {
      viable = false;
      viabilityReason = `Falta alineación obligatoria 4H+1H+15M (${matchCount}/4 marcos alineados)`;
    } else if (historicalReactionFrames < 3) {
      viable = false;
      viabilityReason = `Poca reacción institucional hoy (${historicalReactionFrames}/4 marcos activos en últimas 8h)`;
    } else if (!structureOk) {
      viable = false;
      viabilityReason = structureReason || 'Estructura M15 adversa (máximo/mínimo vulnerado)';
    } else if (projection.recorrido > 45) {
      viable = false;
      viabilityReason = `Movimiento tardío: recorrido ya en ${projection.recorrido}% (máx 45% para entrar con margen)`;
    } else if (extremeZoneConflict) {
      viable = false;
      viabilityReason = base.symbolClass === 'crash'
        ? `Precio muy abajo en piso de 1H (${pos1h}%) — riesgo de rebote alcista`
        : `Precio muy arriba en techo de 1H (${pos1h}%) — riesgo de caída`;
    } else if (projection.rb < 7.5) {
      viable = false;
      viabilityReason = `R/B insuficiente (${projection.rb}, mínimo exigido 7.5)`;
    } else {
      viable = true;
      const alignedText = matchCount === 4 ? 'Alineado 4H/1H/30M/15M' : `${matchCount}/4 marcos (4H+1H+15M OK)`;
      viabilityReason = `Sniper Viable: ${alignedText} · OB ${base.pullbackPct}% · ${base.recentSpikesCount} spikes/3h`;
    }

    // ── Asignación Estricta de Estrellas (4★ reservado a entradas Sniper perfectas) ──
    if (!viable) {
      // Ninguna señal NO viable puede tener 3★ ni 4★ (máximo 2★)
      stars = Math.min(stars, 2);
    } else {
      const isSniperFourStars =
        matchCount === 4 &&
        base.inOrderBlockZone &&
        (base.recentSpikesCount ?? 0) >= 3 &&
        projection.recorrido <= 38 &&
        projection.rb >= 8.5 &&
        historicalReactionFrames >= 3;

      stars = isSniperFourStars ? 4 : 3;
    }

    return {
      ...base,
      sl: projection.sl,
      tp: projection.tp,
      rb: projection.rb,
      recorrido: projection.recorrido,
      stars,
      alignment,
      alignmentDetail,
      macroTrend,
      macroTrendOk,
      macroTrendH4,
      macroTrendH4Ok,
      structureOk,
      historyContext,
      historicalReactionFrames,
      viable,
      viabilityReason,
    };
  }

  /**
   * Devuelve UNA señal por símbolo (granularidad 5m) para todos los símbolos
   * CRASH y BOOM que tengan datos en la BD.
   * Los resultados vienen ordenados: Crash primero → Boom, y dentro de cada
   * grupo por número (500 → 1000).
   */
  async getAllSignals(): Promise<SignalResult[]> {
    const pairs = await this.candlesService.getAvailableSymbolGranularities();

    // ── Step 1: pick ONE granularity per crash/boom symbol ───────────────────
    // Strategy: prefer 300 (5m) for tactical entry; if not available, use the smallest granularity.
    const best: Record<string, number> = {}; // symbol → chosen granularity

    for (const { symbol, granularity } of pairs) {
      if (!symbol) continue;
      if (!isCrashOrBoom(symbol)) continue;

      if (!(symbol in best)) {
        best[symbol] = granularity;
      } else if (granularity === 300) {
        best[symbol] = 300;
      } else if (best[symbol] !== 300 && granularity < best[symbol]) {
        best[symbol] = granularity;
      }
    }

    // Ensure all known crash/boom symbols are present even before candles arrive
    for (const sym of CRASH_BOOM_KNOWN_SYMBOLS) {
      if (!(sym in best)) {
        best[sym] = 300;
      }
    }

    // ── Step 2: sort crash first, then by numerical index (500 -> 1000) ───────
    const sorted = Object.entries(best).sort(([a], [b]) => {
      const ca = getSymbolClass(a);
      const cb = getSymbolClass(b);
      if (ca !== cb) return ca === 'crash' ? -1 : 1;
      const numA = parseInt(a.match(/\d+/)?.[0] ?? '0', 10);
      const numB = parseInt(b.match(/\d+/)?.[0] ?? '0', 10);
      if (numA !== numB) return numA - numB;
      return a.localeCompare(b);
    });

    this.logger.debug(`getAllSignals: ${sorted.length} unique crash/boom symbols → ${sorted.map(([s, g]) => `${s}@${g}s`).join(', ')}`);

    // ── Step 3: compute one signal per symbol sequentially to avoid DB connection spikes ──
    const results: SignalResult[] = [];
    for (const [symbol, granularity] of sorted) {
      results.push(await this.getSignal(symbol, granularity));
    }
    return results;
  }

  /**
   * Suscribe en batch todos los índices Crash/Boom conocidos.
   * Usa la lista hardcoded porque el endpoint OTP de Deriv no soporta
   * active_symbols. Los símbolos inválidos son rechazados silenciosamente
   * por el error handler de subscribeCandles.
   */
  async subscribeTargetSymbols(): Promise<{ subscribed: string[]; found: number }> {
    const subscribed: string[] = [];
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    for (const symbol of CRASH_BOOM_KNOWN_SYMBOLS) {
      this.derivWs.subscribeTicks(symbol);
      for (const g of [60, 300, 900, 1800, 3600, 14400]) {
        this.derivWs.subscribeCandles(symbol, g);
      }
      subscribed.push(symbol);
      this.logger.log(`  → suscribiendo ${symbol} (1m/5m/15m/30m/1h/4h)`);
      // Small delay between symbols to avoid overwhelming the WS with 50 msgs at once
      await delay(150);
    }

    this.logger.log(`subscribeTargetSymbols: ${subscribed.length} símbolos enviados`);
    return { subscribed, found: subscribed.length };
  }

  /** Diagnóstico: muestra los crash/boom en la BD */
  async debugInfo() {
    const dbPairs    = await this.candlesService.getAvailableSymbolGranularities();
    const dbAll      = dbPairs;
    const dbCrashBoom = dbPairs.filter((p) => isCrashOrBoom(p.symbol));

    return {
      knownSymbols: CRASH_BOOM_KNOWN_SYMBOLS,
      db: {
        totalPairs:    dbAll.length,
        crashBoomPairs: dbCrashBoom,
      },
      note: 'active_symbols API not available on OTP endpoint — using hardcoded list',
    };
  }
}
