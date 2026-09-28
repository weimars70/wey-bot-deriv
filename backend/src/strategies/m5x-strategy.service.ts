import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import { CandlesService } from '../candles/candles.service';

export const M5X_SYMBOLS = [
  'CRASH100',
  'CRASH200',
  'CRASH300N',
  'CRASH500',
  'CRASH600',
  'CRASH900',
  'CRASH1000',
];

interface CandleShape {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
  body: number;
  range: number;
  upperWick: number;
  lowerWick: number;
  bodyRatio: number;
  bodyCenterOffsetRatio: number;
  bullish: boolean;
}

interface PatternDetection {
  valid: boolean;
  body: number;
  range: number;
  bodyRatioPct: number;
  bodyVsAveragePct: number;
  rangeVsAveragePct: number;
  upperWickPct: number;
  lowerWickPct: number;
  entryPrice: number;
  stopLossPrice: number;
}

export interface M5XPatternRow extends PatternDetection {
  id: string;
  symbol: string;
  epoch: number;
  dateStr: string;
  mt5DateStr: string;
  signalCandle?: { open: number; high: number; low: number; close: number; epoch: number };
  spikeCandle?: { open: number; high: number; low: number; close: number; epoch: number };
  spikeFollowed: boolean;
  spikePoints: number;
  spikeDelayCandles: number;
  result: 'SPIKE' | 'NO SPIKE';
}

@Injectable()
export class M5XStrategyService {
  private readonly logger = new Logger(M5XStrategyService.name);
  private readonly mt5FilesDir =
    process.env.MT5_FILES_DIR ||
    'C:/Users/Weimar/AppData/Roaming/MetaQuotes/Terminal/FB9A56D617EDDDFE29EE54EBEFFE96C1/MQL5/Files';

  constructor(private readonly candlesService: CandlesService) {}

  private mercado(symbol: string): string {
    const upper = (symbol || '').toUpperCase();
    const suffix = upper.replace('CRASH', '').replace(/N$/, '');
    return `Crash ${suffix}`;
  }

  private formatMt5Date(epoch: number): string {
    const timeZone = process.env.MT5_TIMEZONE || 'Etc/GMT-1';
    return new Date(epoch * 1000).toLocaleString('es-CO', { timeZone });
  }

  private spikeMinPoints(symbol: string): number {
    if (symbol.includes('1000')) return 8;
    if (symbol.includes('900')) return 9;
    if (symbol.includes('600')) return 12;
    if (symbol.includes('500')) return 14;
    if (symbol.includes('300')) return 20;
    if (symbol.includes('200')) return 30;
    if (symbol.includes('100')) return 40;
    return 14;
  }

  private normalize(candle: any): CandleShape {
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const body = Math.abs(close - open);
    const range = Math.max(0, high - low);
    const upperWick = Math.max(0, high - Math.max(open, close));
    const lowerWick = Math.max(0, Math.min(open, close) - low);
    const candleCenter = low + range / 2;
    const bodyCenter = (open + close) / 2;

    return {
      epoch: Number(candle.epoch),
      open,
      high,
      low,
      close,
      body,
      range,
      upperWick,
      lowerWick,
      bodyRatio: range > 0 ? body / range : 1,
      bodyCenterOffsetRatio: range > 0 ? Math.abs(bodyCenter - candleCenter) / range : 1,
      bullish: close > open,
    };
  }

  private detectPattern(candles: any[], idx: number, symbol: string): PatternDetection {
    const empty: PatternDetection = {
      valid: false,
      body: 0,
      range: 0,
      bodyRatioPct: 0,
      bodyVsAveragePct: 0,
      rangeVsAveragePct: 0,
      upperWickPct: 0,
      lowerWickPct: 0,
      entryPrice: 0,
      stopLossPrice: 0,
    };
    if (idx < 3) return empty;

    const candidate = this.normalize(candles[idx]);
    const recent = candles.slice(idx - 3, idx).map((c) => this.normalize(c));
    const immediatelyPrevious = recent[recent.length - 1];
    const averageRange = recent.reduce((sum, c) => sum + c.range, 0) / recent.length;
    const comparableBodies = recent.filter((c) => c.body > 0).map((c) => c.body);
    const averageComparableBody = comparableBodies.length
      ? comparableBodies.reduce((sum, body) => sum + body, 0) / comparableBodies.length
      : 0;
    if (candidate.range <= 0 || averageRange <= 0 || averageComparableBody <= 0) return empty;

    const upperWickRatio = candidate.upperWick / candidate.range;
    const lowerWickRatio = candidate.lowerWick / candidate.range;
    const rangeVsAverage = candidate.range / averageRange;
    const bodyVsAverage = candidate.body / averageComparableBody;
    const smallestPriorBody = Math.min(...recent.map((c) => c.body));
    const smallestPriorRange = Math.min(...recent.map((c) => c.range));
    const valid =
      candidate.bullish &&
      immediatelyPrevious.bullish &&
      candidate.close > immediatelyPrevious.close &&
      candidate.body > 0 &&
      candidate.body <= smallestPriorBody &&
      candidate.range <= smallestPriorRange &&
      candidate.range > 0;

    return {
      valid,
      body: Number(candidate.body.toFixed(3)),
      range: Number(candidate.range.toFixed(3)),
      bodyRatioPct: Number((candidate.bodyRatio * 100).toFixed(1)),
      bodyVsAveragePct: Number((bodyVsAverage * 100).toFixed(1)),
      rangeVsAveragePct: Number((rangeVsAverage * 100).toFixed(1)),
      upperWickPct: Number((upperWickRatio * 100).toFixed(1)),
      lowerWickPct: Number((lowerWickRatio * 100).toFixed(1)),
      entryPrice: Number(candidate.close.toFixed(3)),
      stopLossPrice: Number((candidate.high + averageRange * 0.35).toFixed(3)),
    };
  }

  private completedCandles(raw: any[]): any[] {
    const currentBucket = Math.floor(Date.now() / 1000 / 300) * 300;
    return [...raw]
      .filter((c) => Number(c.epoch) < currentBucket)
      .sort((a, b) => Number(a.epoch) - Number(b.epoch));
  }

  private loadMt5Candles(symbol: string): any[] {
    const filePath = `${this.mt5FilesDir}/deriv_bridge_m5_${symbol}.json`;
    try {
      if (!fs.existsSync(filePath)) return [];
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (!content.startsWith('[')) return [];
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((c) => Number(c.epoch) > 0)
        .sort((a, b) => Number(a.epoch) - Number(b.epoch));
    } catch (error: any) {
      this.logger.warn(`No se pudo leer historial M5 de MT5 para ${symbol}: ${error?.message}`);
      return [];
    }
  }

  private async getCandles(symbol: string, count: number) {
    const mt5Candles = this.loadMt5Candles(symbol);
    if (mt5Candles.length >= 9) {
      return {
        candles: this.completedCandles(mt5Candles).slice(-count),
        dataSource: 'MT5' as const,
      };
    }

    const derivCandles = await this.candlesService.findLatest(symbol, 300, count);
    return {
      candles: this.completedCandles(derivCandles),
      dataSource: 'DERIV' as const,
    };
  }

  async evaluateLive(symbol: string) {
    const normalizedSymbol = (symbol || 'CRASH500').toUpperCase();
    const safeSymbol = M5X_SYMBOLS.includes(normalizedSymbol) ? normalizedSymbol : 'CRASH500';
    const { candles, dataSource } = await this.getCandles(safeSymbol, 30);

    if (candles.length < 4) {
      return {
        symbol: safeSymbol,
        mercado: this.mercado(safeSymbol),
        timeframe: 'M5',
        dataSource,
        patternDetected: false,
        patternEpoch: 0,
        patternCloseEpoch: 0,
        direction: 'SELL' as const,
        reason: 'Datos insuficientes para evaluar M5X.',
        ...this.detectPattern([], 0, safeSymbol),
      };
    }

    const patternEpoch = Number(candles[candles.length - 1].epoch);
    const detection = this.detectPattern(candles, candles.length - 1, safeSymbol);
    const patternCloseEpoch = patternEpoch + 300;
    return {
      symbol: safeSymbol,
      mercado: this.mercado(safeSymbol),
      timeframe: 'M5',
      dataSource,
      patternDetected: detection.valid,
      patternEpoch,
      patternCloseEpoch,
      direction: 'SELL' as const,
      reason: detection.valid
        ? 'Segunda vela verde consecutiva y más corta que las tres anteriores. Entrada SELL preparada al cierre M5.'
        : 'La última vela M5 cerrada no cumple todas las condiciones de M5X.',
      ...detection,
    };
  }

  async evaluateLiveAll() {
    return Promise.all(M5X_SYMBOLS.map((symbol) => this.evaluateLive(symbol)));
  }

  async runBacktestSymbol(symbol: string, days = 14) {
    const normalizedSymbol = (symbol || 'CRASH500').toUpperCase();
    const safeSymbol = M5X_SYMBOLS.includes(normalizedSymbol) ? normalizedSymbol : 'CRASH500';
    const safeDays = Math.min(Math.max(Number(days) || 14, 1), 60);
    const candlesNeeded = Math.min(safeDays * 24 * 12 + 100, 9000);
    const { candles, dataSource } = await this.getCandles(safeSymbol, candlesNeeded);
    const cutoffEpoch = Math.floor(Date.now() / 1000) - safeDays * 86400;
    const spikeThreshold = this.spikeMinPoints(safeSymbol);
    const patterns: M5XPatternRow[] = [];

    for (let i = 3; i < candles.length - 1; i++) {
      if (Number(candles[i].epoch) < cutoffEpoch) continue;
      const detection = this.detectPattern(candles, i, safeSymbol);
      if (!detection.valid) continue;

      let spikeFollowed = false;
      let spikePoints = 0;
      let spikeDelayCandles = 0;
      let spikeCandle: { open: number; high: number; low: number; close: number; epoch: number } | undefined;
      // M5X confirma la señal únicamente con la vela M5 inmediatamente siguiente.
      for (let delay = 1; delay <= 1; delay++) {
        const future = this.normalize(candles[i + delay]);
        const magnitude = Number(future.open) - Number(future.low);
        if (magnitude >= spikeThreshold) {
          spikeFollowed = true;
          spikePoints = Number(magnitude.toFixed(2));
          spikeDelayCandles = delay;
          spikeCandle = {
            epoch: Number(candles[i + delay].epoch),
            open: Number(candles[i + delay].open),
            high: Number(candles[i + delay].high),
            low: Number(candles[i + delay].low),
            close: Number(candles[i + delay].close),
          };
          break;
        }
      }

      const date = new Date(Number(candles[i].epoch) * 1000);
      patterns.push({
        ...detection,
        id: `${safeSymbol}_${candles[i].epoch}`,
        symbol: safeSymbol,
        epoch: Number(candles[i].epoch),
        dateStr: date.toLocaleString('es-CO'),
        mt5DateStr: this.formatMt5Date(Number(candles[i].epoch)),
        signalCandle: {
          epoch: Number(candles[i].epoch),
          open: Number(candles[i].open),
          high: Number(candles[i].high),
          low: Number(candles[i].low),
          close: Number(candles[i].close),
        },
        spikeCandle,
        spikeFollowed,
        spikePoints,
        spikeDelayCandles,
        result: spikeFollowed ? 'SPIKE' : 'NO SPIKE',
      });
    }

    const withSpike = patterns.filter((row) => row.spikeFollowed).length;
    const totalPatterns = patterns.length;
    return {
      symbol: safeSymbol,
      mercado: this.mercado(safeSymbol),
      dataSource,
      days: safeDays,
      totalPatterns,
      withSpike,
      withoutSpike: totalPatterns - withSpike,
      spikeRatePct: totalPatterns
        ? Number(((withSpike / totalPatterns) * 100).toFixed(1))
        : 0,
      patterns: patterns.reverse(),
    };
  }

  async runBacktestAll(days = 14) {
    this.logger.log(`M5X backtest de índices CRASH por ${days} días`);
    const results = await Promise.all(
      M5X_SYMBOLS.map((symbol) => this.runBacktestSymbol(symbol, days)),
    );
    const totalPatterns = results.reduce((sum, result) => sum + result.totalPatterns, 0);
    const withSpike = results.reduce((sum, result) => sum + result.withSpike, 0);
    return {
      days: Math.min(Math.max(Number(days) || 14, 1), 60),
      symbols: results.map(({ patterns, ...summary }) => summary),
      totals: {
        totalPatterns,
        withSpike,
        withoutSpike: totalPatterns - withSpike,
        spikeRatePct: totalPatterns
          ? Number(((withSpike / totalPatterns) * 100).toFixed(1))
          : 0,
      },
    };
  }
}
