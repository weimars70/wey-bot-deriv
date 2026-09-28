import { Injectable, Logger } from '@nestjs/common';
import { CandlesService } from '../candles/candles.service';

// ─── Símbolos soportados ──────────────────────────────────────────────────────
export const M5PLUS_SYMBOLS = [
  'CRASH300N', 'CRASH500', 'CRASH600', 'CRASH900', 'CRASH1000',
  'BOOM300N',  'BOOM500',  'BOOM600',  'BOOM900',  'BOOM1000',
];

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface M5PlusPatternRow {
  id: string;
  symbol: string;
  epoch: number;
  dateStr: string;
  direction: 'SELL' | 'BUY';
  dojiBody: number;         // cuerpo de la vela doji/pin bar en pts
  dojiWickRatio: number;    // % de mecha sobre el rango total
  signalBody: number;       // cuerpo de la vela señal (alcista en CRASH, bajista en BOOM)
  entryPrice: number;
  stopLossPrice: number;
  spikeFollowed: boolean;
  spikePoints: number;
  spikeDelayCandles: number;
  result: 'SPIKE' | 'NO SPIKE';
}

export interface M5PlusBacktestResult {
  symbol: string;
  days: number;
  totalPatterns: number;
  withSpike: number;
  withoutSpike: number;
  spikeRatePct: number;
  avgSpikePoints: number;
  avgDelayCandles: number;
  patterns: M5PlusPatternRow[];
}

export interface M5PlusAllSymbolsResult {
  days: number;
  symbols: Array<{
    symbol: string;
    mercado: string;
    direction: 'SELL' | 'BUY';
    totalPatterns: number;
    withSpike: number;
    spikeRatePct: number;
    avgSpikePoints: number;
  }>;
  totals: {
    totalPatterns: number;
    withSpike: number;
    spikeRatePct: number;
  };
}

// ─── Parámetros por índice ────────────────────────────────────────────────────
interface SymbolParams {
  spikeMinPts: number;      // pts mínimos para clasificar un spike
  signalMinBody: number;    // body mínimo de la vela señal (alcista/bajista)
  dojiMaxBodyRatio: number; // body del doji debe ser <= este % del rango total
  dojiMinWickRatio: number; // mecha total del doji debe ser >= este % del rango
  slBufferPts: number;      // buffer del stop loss por encima del high/low del doji
  direction: 'SELL' | 'BUY';
}

@Injectable()
export class M5PlusStrategyService {
  private readonly logger = new Logger(M5PlusStrategyService.name);

  constructor(private readonly candlesService: CandlesService) {}

  // ── Parámetros adaptativos por índice ────────────────────────────────────
  private params(symbol: string): SymbolParams {
    const up = (symbol || '').toUpperCase();
    const isBoom = up.includes('BOOM');
    const direction: 'SELL' | 'BUY' = isBoom ? 'BUY' : 'SELL';

    // signalMinBody = body mínimo de la vela señal (la alcista en CRASH, bajista en BOOM)
    // slBufferPts   = puntos extra por encima del high del doji para el SL
    if (up.includes('1000')) return { spikeMinPts: 8.0,  signalMinBody: 2.5, dojiMaxBodyRatio: 0.30, dojiMinWickRatio: 0.55, slBufferPts: 3.0,  direction };
    if (up.includes('900'))  return { spikeMinPts: 9.0,  signalMinBody: 3.0, dojiMaxBodyRatio: 0.30, dojiMinWickRatio: 0.55, slBufferPts: 3.5,  direction };
    if (up.includes('600'))  return { spikeMinPts: 12.0, signalMinBody: 4.0, dojiMaxBodyRatio: 0.30, dojiMinWickRatio: 0.55, slBufferPts: 5.0,  direction };
    if (up.includes('500'))  return { spikeMinPts: 14.0, signalMinBody: 4.5, dojiMaxBodyRatio: 0.30, dojiMinWickRatio: 0.55, slBufferPts: 6.0,  direction };
    if (up.includes('300'))  return { spikeMinPts: 18.0, signalMinBody: 5.5, dojiMaxBodyRatio: 0.30, dojiMinWickRatio: 0.55, slBufferPts: 7.5,  direction };
    return                           { spikeMinPts: 10.0, signalMinBody: 3.5, dojiMaxBodyRatio: 0.30, dojiMinWickRatio: 0.55, slBufferPts: 4.0,  direction };
  }

  private mercado(symbol: string): string {
    const map: Record<string, string> = {
      CRASH300N: 'Crash 300',
      CRASH500: 'Crash 500', CRASH600: 'Crash 600',
      CRASH900: 'Crash 900', CRASH1000: 'Crash 1000',
      BOOM300N: 'Boom 300',
      BOOM500: 'Boom 500',   BOOM600: 'Boom 600',
      BOOM900: 'Boom 900',   BOOM1000: 'Boom 1000',
    };
    return map[symbol.toUpperCase()] ?? symbol;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DETECCIÓN DEL PATRÓN M5++
  //
  // CRASH (SELL) — se ve en imagen 1:
  //   Vela N-1 (doji/pin bar): cuerpo muy pequeño + mechas largas a ambos lados
  //                            → indica indecisión / agotamiento
  //   Vela N   (señal alcista): cuerpo grande ALCISTA (close >> open)
  //                            → sube con fuerza, agota a los compradores
  //   Resultado esperado: spike BAJISTA en las siguientes 1–6 velas M5
  //   Entrada: al cierre de la vela señal (short/SELL)
  //   SL: por encima del máximo del doji + buffer
  //
  // BOOM (BUY) — imagen 2, lo simétrico:
  //   Vela N-1 (doji/pin bar): cuerpo pequeño + mechas largas
  //   Vela N   (señal bajista): cuerpo grande BAJISTA (close << open)
  //                            → baja con fuerza, agota a los vendedores
  //   Resultado esperado: spike ALCISTA en las siguientes 1–6 velas M5
  //   Entrada: al cierre de la vela señal (long/BUY)
  //   SL: por debajo del mínimo del doji - buffer
  // ─────────────────────────────────────────────────────────────────────────
  private detectPattern(
    candles: { epoch: number; open: number; high: number; low: number; close: number }[],
    idx: number,
    p: SymbolParams,
    isBoom: boolean,
  ): {
    valid: boolean;
    dojiBody: number;
    dojiWickRatio: number;
    signalBody: number;
    entryPrice: number;
    stopLossPrice: number;
  } {
    const EMPTY = { valid: false, dojiBody: 0, dojiWickRatio: 0, signalBody: 0, entryPrice: 0, stopLossPrice: 0 };
    if (idx < 2) return EMPTY;

    const raw = (c: typeof candles[0]) => {
      const open  = Number(c.open);
      const high  = Number(c.high);
      const low   = Number(c.low);
      const close = Number(c.close);
      const body       = Math.abs(close - open);
      const range      = high - low;
      const upperWick  = Math.max(0, high - Math.max(open, close));
      const lowerWick  = Math.max(0, Math.min(open, close) - low);
      const totalWick  = upperWick + lowerWick;
      const bodyRatio  = range > 0 ? body / range : 1;
      const wickRatio  = range > 0 ? totalWick / range : 0;
      return { open, high, low, close, body, range, upperWick, lowerWick, totalWick, bodyRatio, wickRatio };
    };

    const doji   = raw(candles[idx - 1]); // vela anterior: debe ser doji/pin bar
    const signal = raw(candles[idx]);      // vela actual: vela señal

    // ── Filtro 1: el doji debe tener rango mínimo (no ser una vela plana sin significado)
    if (doji.range < 1.0) return EMPTY;

    // ── Filtro 2: doji — cuerpo pequeño (< 30% del rango) + mechas largas (> 55% del rango)
    if (doji.bodyRatio > p.dojiMaxBodyRatio) return EMPTY;   // cuerpo demasiado grande
    if (doji.wickRatio < p.dojiMinWickRatio) return EMPTY;   // mechas insuficientes

    // ── Filtro 3: la vela señal debe tener cuerpo suficientemente grande
    if (signal.body < p.signalMinBody) return EMPTY;

    // ── Filtro 4: dirección de la vela señal
    // CRASH → señal ALCISTA (el alza agota a los compradores → viene spike bajista)
    // BOOM  → señal BAJISTA (la baja agota a los vendedores → viene spike alcista)
    const signalIsBullish = signal.close > signal.open;
    if (!isBoom && !signalIsBullish) return EMPTY; // CRASH necesita señal alcista
    if (isBoom  &&  signalIsBullish) return EMPTY; // BOOM  necesita señal bajista

    // ── Cálculo de entrada y stop loss
    // Entrada al cierre de la vela señal
    // SL: en CRASH encima del máximo del doji; en BOOM debajo del mínimo del doji
    const entryPrice    = Number(signal.close.toFixed(3));
    const stopLossPrice = isBoom
      ? Number((doji.low  - p.slBufferPts).toFixed(3))  // BOOM: SL bajo el doji
      : Number((doji.high + p.slBufferPts).toFixed(3)); // CRASH: SL sobre el doji

    return {
      valid: true,
      dojiBody: Number(doji.body.toFixed(3)),
      dojiWickRatio: Number((doji.wickRatio * 100).toFixed(1)),
      signalBody: Number(signal.body.toFixed(3)),
      entryPrice,
      stopLossPrice,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BACKTESTING DE UN SÍMBOLO
  // ─────────────────────────────────────────────────────────────────────────
  async runBacktestSymbol(symbol: string, days: number): Promise<M5PlusBacktestResult> {
    symbol = (symbol || 'CRASH600').toUpperCase();
    if (!M5PLUS_SYMBOLS.includes(symbol)) symbol = 'CRASH600';

    const p      = this.params(symbol);
    const isBoom = symbol.startsWith('BOOM');
    const candlesNeeded = Math.min(days * 24 * 12 + 100, 3000);

    this.logger.log(`M5++ Backtest ${symbol} — ${days} días (~${candlesNeeded} velas M5)`);

    const raw = await this.candlesService.findLatest(symbol, 300, candlesNeeded);
    const candles = [...raw]
      .sort((a, b) => Number(a.epoch) - Number(b.epoch))
      .map((c) => ({
        epoch: Number(c.epoch),
        open: Number(c.open),
        high: Number(c.high),
        low:  Number(c.low),
        close: Number(c.close),
      }));

    if (candles.length < 10) {
      return { symbol, days, totalPatterns: 0, withSpike: 0, withoutSpike: 0,
               spikeRatePct: 0, avgSpikePoints: 0, avgDelayCandles: 0, patterns: [] };
    }

    const cutoffEpoch = Math.floor(Date.now() / 1000) - days * 86400;
    const patterns: M5PlusPatternRow[] = [];
    let cooldownUntil = -1;

    for (let i = 2; i < candles.length - 6; i++) {
      if (Number(candles[i].epoch) < cutoffEpoch) continue;
      if (i <= cooldownUntil) continue;

      const det = this.detectPattern(candles, i, p, isBoom);
      if (!det.valid) continue;

      // Buscar spike en las siguientes 1–6 velas M5 (~30 min)
      let spikeFollowed     = false;
      let spikePoints       = 0;
      let spikeDelayCandles = 0;
      const lookAhead = Math.min(6, candles.length - i - 1);

      for (let j = 1; j <= lookAhead; j++) {
        const fc = candles[i + j];
        // Spike bajista en CRASH: open - low; spike alcista en BOOM: high - open
        const magnitude = isBoom
          ? (Number(fc.high) - Number(fc.open))
          : (Number(fc.open) - Number(fc.low));

        if (magnitude >= p.spikeMinPts) {
          spikeFollowed     = true;
          spikePoints       = Number(magnitude.toFixed(2));
          spikeDelayCandles = j;
          break;
        }
      }

      const d   = new Date(candles[i].epoch * 1000);
      const pad = (n: number) => n.toString().padStart(2, '0');
      const dateStr = `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

      patterns.push({
        id: `M5PP-${symbol}-${candles[i].epoch}`,
        symbol,
        epoch: candles[i].epoch,
        dateStr,
        direction: p.direction,
        dojiBody: det.dojiBody,
        dojiWickRatio: det.dojiWickRatio,
        signalBody: det.signalBody,
        entryPrice: det.entryPrice,
        stopLossPrice: det.stopLossPrice,
        spikeFollowed,
        spikePoints,
        spikeDelayCandles,
        result: spikeFollowed ? 'SPIKE' : 'NO SPIKE',
      });

      cooldownUntil = i + 3; // cooldown de 3 velas entre patrones
    }

    patterns.reverse(); // más recientes primero

    const withSpike    = patterns.filter((r) => r.spikeFollowed).length;
    const withoutSpike = patterns.length - withSpike;
    const spikeRatePct = patterns.length > 0
      ? Number(((withSpike / patterns.length) * 100).toFixed(1))
      : 0;
    const avgSpikePoints = withSpike > 0
      ? Number((patterns.filter((r) => r.spikeFollowed).reduce((a, b) => a + b.spikePoints, 0) / withSpike).toFixed(2))
      : 0;
    const avgDelayCandles = withSpike > 0
      ? Number((patterns.filter((r) => r.spikeFollowed).reduce((a, b) => a + b.spikeDelayCandles, 0) / withSpike).toFixed(1))
      : 0;

    return { symbol, days, totalPatterns: patterns.length, withSpike, withoutSpike,
             spikeRatePct, avgSpikePoints, avgDelayCandles, patterns };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BACKTESTING DE TODOS LOS SÍMBOLOS
  // ─────────────────────────────────────────────────────────────────────────
  async runBacktestAll(days: number): Promise<M5PlusAllSymbolsResult> {
    this.logger.log(`M5++ Backtest ALL — ${days} días`);
    const results = await Promise.all(
      M5PLUS_SYMBOLS.map((sym) => this.runBacktestSymbol(sym, days)),
    );
    const symbols = results.map((r) => ({
      symbol: r.symbol,
      mercado: this.mercado(r.symbol),
      direction: this.params(r.symbol).direction,
      totalPatterns: r.totalPatterns,
      withSpike: r.withSpike,
      spikeRatePct: r.spikeRatePct,
      avgSpikePoints: r.avgSpikePoints,
    }));
    const totalPatterns = symbols.reduce((a, b) => a + b.totalPatterns, 0);
    const withSpike     = symbols.reduce((a, b) => a + b.withSpike, 0);
    const spikeRatePct  = totalPatterns > 0
      ? Number(((withSpike / totalPatterns) * 100).toFixed(1))
      : 0;
    return { days, symbols, totals: { totalPatterns, withSpike, spikeRatePct } };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EVALUACIÓN EN TIEMPO REAL
  // ─────────────────────────────────────────────────────────────────────────
  async evaluateLive(symbol: string): Promise<{
    symbol: string;
    mercado: string;
    direction: 'SELL' | 'BUY';
    patternDetected: boolean;
    dojiBody: number;
    dojiWickRatio: number;
    signalBody: number;
    entryPrice: number;
    stopLossPrice: number;
    reason: string;
  }> {
    symbol = (symbol || 'CRASH600').toUpperCase();
    const p      = this.params(symbol);
    const isBoom = symbol.startsWith('BOOM');
    const merc   = this.mercado(symbol);

    const raw = await this.candlesService.findLatest(symbol, 300, 20);
    const candles = [...raw]
      .sort((a, b) => Number(a.epoch) - Number(b.epoch))
      .map((c) => ({
        epoch: Number(c.epoch),
        open: Number(c.open), high: Number(c.high),
        low:  Number(c.low),  close: Number(c.close),
      }));

    if (candles.length < 3) {
      return { symbol, mercado: merc, direction: p.direction, patternDetected: false,
               dojiBody: 0, dojiWickRatio: 0, signalBody: 0, entryPrice: 0, stopLossPrice: 0,
               reason: 'Datos insuficientes' };
    }

    const lastIdx = candles.length - 1;
    const det = this.detectPattern(candles, lastIdx, p, isBoom);

    const dirLabel = isBoom ? 'bajista' : 'alcista';
    return {
      symbol,
      mercado: merc,
      direction: p.direction,
      patternDetected: det.valid,
      dojiBody: det.dojiBody,
      dojiWickRatio: det.dojiWickRatio,
      signalBody: det.signalBody,
      entryPrice: det.entryPrice,
      stopLossPrice: det.stopLossPrice,
      reason: det.valid
        ? `Patrón M5++ detectado: doji (${det.dojiBody} pts cuerpo, ${det.dojiWickRatio}% mecha) + vela ${dirLabel} ${det.signalBody} pts.`
        : 'Sin patrón M5++ activo en este momento.',
    };
  }

  async evaluateLiveAll(): Promise<Awaited<ReturnType<typeof this.evaluateLive>>[]> {
    const results = await Promise.all(M5PLUS_SYMBOLS.map((sym) => this.evaluateLive(sym)));
    return results;
  }
}
