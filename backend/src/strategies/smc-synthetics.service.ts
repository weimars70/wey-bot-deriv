import { Injectable, Logger } from '@nestjs/common';
import { CandlesService } from '../candles/candles.service';
import { DerivWebsocketService } from '../deriv/deriv-websocket.service';

// ─── Símbolos Sintéticos ───────────────────────────────────────────────────────
export interface SyntheticSymbol {
  symbol: string;
  name: string;
  category: 'METALS' | 'FOREX' | 'STEP' | 'VOLATILITY' | 'JUMP';
}

function getDecimals(symbol: string): number {
  if (symbol.includes('EUR') || symbol.includes('GBPUSD') || symbol.includes('AUD')) return 5;
  if (symbol.includes('JPY')) return 3;
  if (symbol.includes('XAU')) return 2;
  if (symbol.includes('XAG')) return 3;
  if (symbol === 'stpRNG') return 1;
  return 4;
}

export const SYNTHETIC_KNOWN_SYMBOLS: SyntheticSymbol[] = [
  // Oro y Metales
  { symbol: 'frxXAUUSD', name: 'Oro (XAU/USD)',        category: 'METALS' },
  { symbol: 'frxXAGUSD', name: 'Plata (XAG/USD)',      category: 'METALS' },
  // Forex con alta volatilidad / correlación
  { symbol: 'frxGBPJPY', name: 'GBP/JPY',              category: 'FOREX' },
  { symbol: 'frxGBPUSD', name: 'GBP/USD',              category: 'FOREX' },
  { symbol: 'frxEURUSD', name: 'EUR/USD',              category: 'FOREX' },
  { symbol: 'frxUSDJPY', name: 'USD/JPY',              category: 'FOREX' },
  // Step Index
  { symbol: 'stpRNG',   name: 'Step Index',           category: 'STEP' },
  // Volatility Indices (Estándar)
  { symbol: 'R_10',     name: 'Volatility 10 Index',  category: 'VOLATILITY' },
  { symbol: 'R_25',     name: 'Volatility 25 Index',  category: 'VOLATILITY' },
  { symbol: 'R_50',     name: 'Volatility 50 Index',  category: 'VOLATILITY' },
  { symbol: 'R_75',     name: 'Volatility 75 Index',  category: 'VOLATILITY' },
  { symbol: 'R_100',    name: 'Volatility 100 Index', category: 'VOLATILITY' },
  // Volatility Indices (1-Second)
  { symbol: '1HZ10V',   name: 'Volatility 10 (1s)',   category: 'VOLATILITY' },
  { symbol: '1HZ25V',   name: 'Volatility 25 (1s)',   category: 'VOLATILITY' },
  { symbol: '1HZ50V',   name: 'Volatility 50 (1s)',   category: 'VOLATILITY' },
  { symbol: '1HZ75V',   name: 'Volatility 75 (1s)',   category: 'VOLATILITY' },
  { symbol: '1HZ100V',  name: 'Volatility 100 (1s)',  category: 'VOLATILITY' },
  // Jump Indices
  { symbol: 'JD10',     name: 'Jump 10 Index',        category: 'JUMP' },
  { symbol: 'JD25',     name: 'Jump 25 Index',        category: 'JUMP' },
  { symbol: 'JD50',     name: 'Jump 50 Index',        category: 'JUMP' },
  { symbol: 'JD75',     name: 'Jump 75 Index',        category: 'JUMP' },
  { symbol: 'JD100',    name: 'Jump 100 Index',       category: 'JUMP' },
];

// ─── Tipos del gráfico y SMC ──────────────────────────────────────────────────
export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SmcZone {
  top: number;
  bottom: number;
  center: number;
  direction: 'BUY' | 'SELL';
  reactions: number;
  type: 'OB' | 'FVG' | 'REACTION';
  startTime: number;
  status: 'WAITING_TOUCH' | 'PULLBACK_OK' | 'CHOCH_CONFIRMED' | 'REJECTION';
  chochLevel: number | null;
}

export interface SwingPoint {
  time: number;
  price: number;
  type: 'HH' | 'HL' | 'LH' | 'LL';
  direction: 'HIGH' | 'LOW';
}

export interface FvgZone {
  top: number;
  bottom: number;
  direction: 'BUY' | 'SELL';
  time: number;
}

export interface ObZone {
  top: number;
  bottom: number;
  direction: 'BUY' | 'SELL';
  time: number;
  displacement: number;
}

export interface EntrySignal {
  time: number;
  price: number;
  direction: 'BUY' | 'SELL';
  type: 'CHOCH' | 'REJECTION' | 'OB_MITIGATION';
  sl: number;
  tp: number;
}

export interface ChartData {
  candles: ChartCandle[];
  candlesH1: ChartCandle[];
  smcZones: SmcZone[];
  swingPoints: SwingPoint[];
  fvgZones: FvgZone[];
  obZones: ObZone[];
  htfBiasLine: number | null;
  htfSwingHighs: number[];
  htfSwingLows: number[];
  watchLevel: number | null;
  entrySignals: EntrySignal[];
  currentPrice: number;
  atr: number;
  rangeHigh: number;
  rangeLow: number;
}

export interface SmcSyntheticConditions {
  htfBias: boolean;
  htfBiasLabel: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL';
  hasActiveZone: boolean;
  hasPullback: boolean;
  hasChoCH: boolean;
  inDiscountPremium: boolean;
  notExhausted: boolean;
}

export interface SmcSyntheticResult {
  symbol: string;
  name: string;
  category: 'METALS' | 'FOREX' | 'STEP' | 'VOLATILITY' | 'JUMP';
  direction: 'BUY' | 'SELL';
  ready: boolean;
  score: number; // 0 - 6
  conditions: SmcSyntheticConditions;
  pricePosition: number;
  currentPrice: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskReward: number;
  reason: string;
  chart: ChartData;
}

// ─── Helpers de análisis técnico ──────────────────────────────────────────────
interface CandleRaw {
  high: number;
  low: number;
  close: number;
  open: number;
  epoch: number;
}

function calcATR(candles: CandleRaw[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prev = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / Math.min(slice.length, period);
}

function findSwingsIndexed(candles: CandleRaw[], strength = 2): { highIdxs: number[]; lowIdxs: number[] } {
  const highIdxs: number[] = [];
  const lowIdxs: number[] = [];
  for (let i = strength; i < candles.length - strength; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= strength; j++) {
      if (candles[i - j].high > candles[i].high || candles[i + j].high > candles[i].high) isH = false;
      if (candles[i - j].low  < candles[i].low  || candles[i + j].low  < candles[i].low)  isL = false;
    }
    if (isH) highIdxs.push(i);
    if (isL) lowIdxs.push(i);
  }
  return { highIdxs, lowIdxs };
}

function classifySwings(candles: CandleRaw[], highIdxs: number[], lowIdxs: number[]): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let k = 0; k < highIdxs.length; k++) {
    const idx = highIdxs[k];
    const price = candles[idx].high;
    const type: 'HH' | 'LH' = k > 0 && price < candles[highIdxs[k - 1]].high ? 'LH' : 'HH';
    points.push({ time: candles[idx].epoch, price, type, direction: 'HIGH' });
  }
  for (let k = 0; k < lowIdxs.length; k++) {
    const idx = lowIdxs[k];
    const price = candles[idx].low;
    const type: 'HL' | 'LL' = k > 0 && price < candles[lowIdxs[k - 1]].low ? 'LL' : 'HL';
    points.push({ time: candles[idx].epoch, price, type, direction: 'LOW' });
  }
  return points.sort((a, b) => a.time - b.time);
}

function findFVGs(candles: CandleRaw[], atr: number, minAtr = 0.2): FvgZone[] {
  const result: FvgZone[] = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1]; const curr = candles[i]; const next = candles[i + 1];
    if (prev.high < next.low && (next.low - prev.high) >= minAtr * atr)
      result.push({ top: next.low, bottom: prev.high, direction: 'BUY', time: curr.epoch });
    if (prev.low > next.high && (prev.low - next.high) >= minAtr * atr)
      result.push({ top: prev.low, bottom: next.high, direction: 'SELL', time: curr.epoch });
  }
  return result.slice(-20);
}

function findOBs(candles: CandleRaw[], atr: number, dispAtr = 0.8, minLeg = 1.0): ObZone[] {
  const result: ObZone[] = [];
  for (let i = 2; i < candles.length - 1; i++) {
    const c = candles[i]; const p = candles[i - 1];
    const disp = c.high - c.low;
    if (disp < dispAtr * atr) continue;
    if (c.close > c.open && p.close < p.open && disp >= minLeg * atr)
      result.push({ top: p.open, bottom: p.close, direction: 'BUY', time: p.epoch, displacement: disp / atr });
    if (c.close < c.open && p.close > p.open && disp >= minLeg * atr)
      result.push({ top: p.close, bottom: p.open, direction: 'SELL', time: p.epoch, displacement: disp / atr });
  }
  return result.slice(-10);
}

function buildSyntheticSmcZone(
  candles: CandleRaw[],
  direction: 'BUY' | 'SELL',
  highIdxs: number[],
  lowIdxs: number[],
  atr: number,
  obs: ObZone[],
  fvgs: FvgZone[],
): SmcZone | null {
  const tol = 0.3 * atr;
  const currentPrice = candles[candles.length - 1].close;

  // 1. Priorizar Order Blocks institucionales frescos cercanos al precio
  const dirObs = obs.filter(o => o.direction === direction);
  if (dirObs.length > 0) {
    const latestOb = dirObs[dirObs.length - 1];
    const center = (latestOb.top + latestOb.bottom) / 2;
    if (Math.abs(center - currentPrice) <= 10 * atr) {
      const top = Math.max(latestOb.top, latestOb.bottom) + 0.1 * atr;
      const bottom = Math.min(latestOb.top, latestOb.bottom) - 0.1 * atr;

      // Evaluar CHoCH o rechazo
      const last10 = candles.slice(-10);
      const lc = last10[last10.length - 1];
      let status: SmcZone['status'] = 'WAITING_TOUCH';
      let chochLevel: number | null = null;

      const midHigh = Math.max(...last10.slice(0, -2).map(c => c.high));
      const midLow  = Math.min(...last10.slice(0, -2).map(c => c.low));

      if (direction === 'BUY' && lc.close > midHigh) {
        chochLevel = midHigh;
        status = 'CHOCH_CONFIRMED';
      } else if (direction === 'SELL' && lc.close < midLow) {
        chochLevel = midLow;
        status = 'CHOCH_CONFIRMED';
      } else {
        const range = lc.high - lc.low;
        if (range > 0) {
          const touched = Math.abs(lc.low - center) <= tol || Math.abs(lc.high - center) <= tol;
          if (touched) {
            const wDown = Math.min(lc.open, lc.close) - lc.low;
            const wUp   = lc.high - Math.max(lc.open, lc.close);
            if (direction === 'BUY' && wDown / range >= 0.35) {
              chochLevel = center;
              status = 'REJECTION';
            } else if (direction === 'SELL' && wUp / range >= 0.35) {
              chochLevel = center;
              status = 'REJECTION';
            }
          }
        }
      }

      if (status === 'WAITING_TOUCH') {
        const last25 = candles.slice(-25);
        const dc = last25.filter(c => direction === 'BUY' ? c.close < c.open : c.close > c.open).length;
        if ((dc / last25.length) >= 0.55) status = 'PULLBACK_OK';
      }

      return {
        top,
        bottom,
        center,
        direction,
        reactions: 3,
        type: 'OB',
        startTime: latestOb.time,
        status,
        chochLevel,
      };
    }
  }

  // 2. Si no hay OB cercano, usar zonas de reacción por swings agrupados
  const pivotIdxs = direction === 'BUY' ? lowIdxs : highIdxs;
  const groups: { center: number; reactions: number; oldestIdx: number }[] = [];
  for (const idx of pivotIdxs) {
    if (idx < 10) continue;
    const price = direction === 'BUY' ? candles[idx].low : candles[idx].high;
    const existing = groups.find(g => Math.abs(g.center - price) <= tol);
    if (existing) {
      existing.reactions++;
      existing.center = (existing.center + price) / 2;
    } else {
      groups.push({ center: price, reactions: 1, oldestIdx: idx });
    }
  }

  const valid = groups
    .filter(g => g.reactions >= 2 && Math.abs(g.center - currentPrice) <= 8 * atr)
    .sort((a, b) => Math.abs(a.center - currentPrice) - Math.abs(b.center - currentPrice));

  if (!valid.length) return null;
  const best = valid[0];

  return {
    top: best.center + tol,
    bottom: best.center - tol,
    center: best.center,
    direction,
    reactions: best.reactions,
    type: 'REACTION',
    startTime: candles[best.oldestIdx].epoch,
    status: 'WAITING_TOUCH',
    chochLevel: null,
  };
}

// ─── Servicio Principal ───────────────────────────────────────────────────────
@Injectable()
export class SmcSyntheticsService {
  private readonly logger = new Logger(SmcSyntheticsService.name);

  private cacheExpiry = 0;
  private cachedResults: SmcSyntheticResult[] = [];
  private chartCacheExpiry = new Map<string, number>();
  private chartCacheData   = new Map<string, ChartData>();
  private readonly historicalCandlesMemory = new Map<string, { m5: CandleRaw[]; h1: CandleRaw[]; expires: number }>();

  constructor(
    private readonly candlesService: CandlesService,
    private readonly derivWs: DerivWebsocketService,
  ) {}

  async scanAll(): Promise<SmcSyntheticResult[]> {
    const now = Date.now();
    if (now < this.cacheExpiry && this.cachedResults.length > 0) {
      return this.cachedResults;
    }

    const results: SmcSyntheticResult[] = [];
    for (const sym of SYNTHETIC_KNOWN_SYMBOLS) {
      results.push(await this.evaluateSynthetic(sym));
      await new Promise(r => setTimeout(r, 50));
    }

    // Ordenar: Listos para operar primero, luego por mayor score
    results.sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? -1 : 1;
      return b.score - a.score;
    });

    this.cachedResults = results;
    this.cacheExpiry = now + 25_000; // Cache 25 segundos
    return results;
  }

  async getChartData(symbol: string): Promise<ChartData | null> {
    const now = Date.now();
    if (this.chartCacheData.has(symbol) && (this.chartCacheExpiry.get(symbol) ?? 0) > now) {
      return this.chartCacheData.get(symbol)!;
    }

    const entry = SYNTHETIC_KNOWN_SYMBOLS.find(e => e.symbol === symbol);
    if (!entry) return null;

    const result = await this.evaluateSynthetic(entry);
    this.chartCacheData.set(symbol, result.chart);
    this.chartCacheExpiry.set(symbol, now + 25_000);
    return result.chart;
  }

  /**
   * Helper con timeout para llamadas a Deriv WS
   */
  private async safeGetHistory(symbol: string, granularity: number, count: number): Promise<any[]> {
    try {
      const promise = this.derivWs.getCandlesHistory(symbol, granularity, count);
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000));
      const resp: any = await Promise.race([promise, timeout]);
      return Array.isArray(resp?.candles) ? resp.candles : [];
    } catch {
      return [];
    }
  }

  /**
   * Obtiene velas de PostgreSQL y, si faltan, solicita historial a Deriv mediante WS
   */
  private async loadCandles(symbol: string): Promise<{ m5: CandleRaw[]; h1: CandleRaw[] }> {
    const now = Date.now();
    const mem = this.historicalCandlesMemory.get(symbol);
    if (mem && mem.expires > now && mem.m5.length >= 20) {
      return { m5: mem.m5, h1: mem.h1 };
    }

    try {
      const [m5Raw, h1Raw] = await Promise.all([
        this.candlesService.findLatest(symbol, 300, 200).catch(() => []),
        this.candlesService.findLatest(symbol, 3600, 100).catch(() => []),
      ]);

      let m5: CandleRaw[] = [...m5Raw].reverse().map(c => ({
        open: +c.open, high: +c.high, low: +c.low, close: +c.close, epoch: +c.epoch,
      }));
      let h1: CandleRaw[] = [...h1Raw].reverse().map(c => ({
        open: +c.open, high: +c.high, low: +c.low, close: +c.close, epoch: +c.epoch,
      }));

      // Si la BD no tiene suficientes velas acumuladas, traemos historial puntual de Deriv
      if (m5.length < 20) {
        const candles = await this.safeGetHistory(symbol, 300, 150);
        if (candles.length > 0) {
          m5 = candles.map((c: any) => ({
            open: +c.open, high: +c.high, low: +c.low, close: +c.close, epoch: +c.epoch,
          }));
        }
      }

      if (h1.length < 4) {
        const candles = await this.safeGetHistory(symbol, 3600, 80);
        if (candles.length > 0) {
          h1 = candles.map((c: any) => ({
            open: +c.open, high: +c.high, low: +c.low, close: +c.close, epoch: +c.epoch,
          }));
        }
      }

      if (m5.length > 0) {
        this.historicalCandlesMemory.set(symbol, { m5, h1, expires: now + 40_000 });
      }

      return { m5, h1 };
    } catch (err: any) {
      this.logger.error(`Error cargando velas para ${symbol}: ${err?.message || err}`);
      return { m5: [], h1: [] };
    }
  }

  private async evaluateSynthetic(sym: SyntheticSymbol): Promise<SmcSyntheticResult> {
    const empty: ChartData = {
      candles: [], candlesH1: [], smcZones: [], swingPoints: [], fvgZones: [], obZones: [],
      htfBiasLine: null, htfSwingHighs: [], htfSwingLows: [], watchLevel: null,
      entrySignals: [], currentPrice: 0, atr: 0, rangeHigh: 0, rangeLow: 0,
    };

    const def: SmcSyntheticResult = {
      symbol: sym.symbol,
      name: sym.name,
      category: sym.category,
      direction: 'BUY',
      ready: false,
      score: 0,
      conditions: {
        htfBias: false,
        htfBiasLabel: 'NEUTRAL',
        hasActiveZone: false,
        hasPullback: false,
        hasChoCH: false,
        inDiscountPremium: false,
        notExhausted: false,
      },
      pricePosition: 50,
      currentPrice: 0,
      entryPrice: 0,
      stopLossPrice: 0,
      takeProfitPrice: 0,
      riskReward: 0,
      reason: 'Cargando datos...',
      chart: empty,
    };

    try {
      const { m5, h1 } = await this.loadCandles(sym.symbol);

      if (m5.length < 20 || h1.length < 4) {
        return { ...def, reason: 'Sincronizando velas de mercado...' };
      }

      const currentPrice = m5[m5.length - 1].close;
      const atr = calcATR(m5, 14);
      if (atr === 0) return { ...def, currentPrice, reason: 'Volatilidad plana (ATR=0)' };

      // Swings M5
      const { highIdxs, lowIdxs } = findSwingsIndexed(m5, 2);
      const swingPoints = classifySwings(m5, highIdxs, lowIdxs);

      // Sesgo H1
      const h1sw = findSwingsIndexed(h1, 2);
      const h1Highs = h1sw.highIdxs.map(i => h1[i].high);
      const h1Lows  = h1sw.lowIdxs.map(i => h1[i].low);
      const h1LC    = h1[h1.length - 1].close;

      let htfBiasLabel: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL' = 'NEUTRAL';
      if (h1Highs.length >= 2 && h1Lows.length >= 2) {
        const hhOk = h1Highs[h1Highs.length - 1] > h1Highs[h1Highs.length - 2];
        const hlOk = h1Lows[h1Lows.length - 1]   > h1Lows[h1Lows.length - 2];
        const lhOk = h1Highs[h1Highs.length - 1] < h1Highs[h1Highs.length - 2];
        const llOk = h1Lows[h1Lows.length - 1]   < h1Lows[h1Lows.length - 2];

        if (hhOk && hlOk && h1LC >= h1Lows[h1Lows.length - 1]) {
          htfBiasLabel = 'ALCISTA';
        } else if (lhOk && llOk && h1LC <= h1Highs[h1Highs.length - 1]) {
          htfBiasLabel = 'BAJISTA';
        }
      }

      // Si H1 está neutral, apoyarse en la tendencia del último tramo M5
      if (htfBiasLabel === 'NEUTRAL') {
        const m5CloseStart = m5[Math.max(0, m5.length - 30)].close;
        htfBiasLabel = currentPrice >= m5CloseStart ? 'ALCISTA' : 'BAJISTA';
      }

      // La dirección la define la estructura de mercado
      const direction: 'BUY' | 'SELL' = htfBiasLabel === 'ALCISTA' ? 'BUY' : 'SELL';
      const htfBias = true; // Por definición alineada al sesgo dominante

      // Rango de negociación (últimas 60 velas M5)
      const r60 = m5.slice(-60);
      const rangeHigh = Math.max(...r60.map(c => c.high));
      const rangeLow  = Math.min(...r60.map(c => c.low));
      const rSize = rangeHigh - rangeLow;
      const pricePosition = rSize > 0 ? ((currentPrice - rangeLow) / rSize) * 100 : 50;

      // Descuento vs Premium (SMC puro: comprar barato en descuento, vender caro en premium)
      const inDiscountPremium = direction === 'BUY' ? pricePosition <= 55 : pricePosition >= 45;
      const notExhausted      = direction === 'BUY' ? pricePosition <= 40 : pricePosition >= 60;

      // Zonas FVG y OB
      const fvgZones = findFVGs(m5, atr);
      const obZones  = findOBs(m5, atr);

      // Zona SMC Activa
      const smcZone = buildSyntheticSmcZone(m5, direction, highIdxs, lowIdxs, atr, obZones, fvgZones);
      const hasActiveZone = !!smcZone;

      // Pullback hacia la zona
      const last25 = m5.slice(-25);
      const pullCandles = last25.filter(c => direction === 'BUY' ? c.close < c.open : c.close > c.open).length;
      const hasPullback = hasActiveZone && (pullCandles / last25.length) >= 0.5;

      // CHoCH o Rechazo
      const hasChoCH = !!(smcZone?.status === 'CHOCH_CONFIRMED' || smcZone?.status === 'REJECTION');

      // Precios de entrada, SL, TP y R:B
      let entryPrice = currentPrice;
      let stopLossPrice = 0;
      let takeProfitPrice = 0;

      const decimals = getDecimals(sym.symbol);
      if (direction === 'BUY') {
        const zoneBottom = smcZone ? smcZone.bottom : currentPrice - 0.7 * atr;
        stopLossPrice = Number((Math.min(entryPrice, zoneBottom) - 0.35 * atr).toFixed(decimals));
        const risk = Math.max(Math.abs(entryPrice - stopLossPrice), 0.4 * atr);
        const targetHigh = Math.max(rangeHigh, entryPrice + 2.8 * risk);
        takeProfitPrice = Number(targetHigh.toFixed(decimals));
      } else {
        const zoneTop = smcZone ? smcZone.top : currentPrice + 0.7 * atr;
        stopLossPrice = Number((Math.max(entryPrice, zoneTop) + 0.35 * atr).toFixed(decimals));
        const risk = Math.max(Math.abs(stopLossPrice - entryPrice), 0.4 * atr);
        const targetLow = Math.min(rangeLow, entryPrice - 2.8 * risk);
        takeProfitPrice = Number(targetLow.toFixed(decimals));
      }
      entryPrice = Number(entryPrice.toFixed(decimals));

      const risk = Math.abs(entryPrice - stopLossPrice);
      const reward = Math.abs(takeProfitPrice - entryPrice);
      const riskReward = risk > 0 ? Number((reward / risk).toFixed(2)) : 2.5;

      // Señal de entrada
      const entrySignals: EntrySignal[] = [];
      if (hasChoCH && smcZone?.chochLevel != null) {
        const lc = m5[m5.length - 1];
        entrySignals.push({
          time: lc.epoch,
          price: smcZone.chochLevel,
          direction,
          type: smcZone.status === 'REJECTION' ? 'REJECTION' : 'CHOCH',
          sl: stopLossPrice,
          tp: takeProfitPrice,
        });
      }

      const conditions: SmcSyntheticConditions = {
        htfBias,
        htfBiasLabel,
        hasActiveZone,
        hasPullback,
        hasChoCH,
        inDiscountPremium,
        notExhausted,
      };

      // Score sobre 6 condiciones institucionales
      const score = [
        htfBias,
        hasActiveZone,
        hasPullback,
        hasChoCH,
        inDiscountPremium,
        notExhausted,
      ].filter(Boolean).length;

      // Listo si tiene al menos 5 de 6 y confirmaciones esenciales
      const ready = score >= 5 && hasActiveZone && inDiscountPremium && (hasChoCH || hasPullback);

      const missing: string[] = [];
      if (!hasActiveZone)     missing.push('sin zona OB/FVG');
      if (!hasPullback)       missing.push('pullback en desarrollo');
      if (!hasChoCH)          missing.push('esperando CHoCH/rechazo');
      if (!inDiscountPremium) missing.push(direction === 'BUY' ? 'precio fuera de descuento' : 'precio fuera de premium');
      if (!notExhausted)      missing.push('recorrido >40%');

      const reason = ready
        ? `⚡ LISTO ${direction} · ${score}/6 · Sesgo ${htfBiasLabel} · R:B 1:${riskReward}`
        : `⏳ ${direction}: ${missing.slice(0, 2).join(', ') || 'esperando gatillo'}`;

      const chart: ChartData = {
        candles:   m5.map(c => ({ time: c.epoch, open: c.open, high: c.high, low: c.low, close: c.close })),
        candlesH1: h1.map(c => ({ time: c.epoch, open: c.open, high: c.high, low: c.low, close: c.close })),
        smcZones:  smcZone ? [smcZone] : [],
        swingPoints,
        fvgZones,
        obZones,
        htfBiasLine: h1Lows.length > 0 ? (direction === 'BUY' ? h1Lows[h1Lows.length - 1] : h1Highs[h1Highs.length - 1]) : null,
        htfSwingHighs: h1Highs.slice(-2),
        htfSwingLows:  h1Lows.slice(-2),
        watchLevel: smcZone ? smcZone.center : null,
        entrySignals,
        currentPrice,
        atr,
        rangeHigh,
        rangeLow,
      };

      return {
        symbol: sym.symbol,
        name: sym.name,
        category: sym.category,
        direction,
        ready,
        score,
        conditions,
        pricePosition: Math.round(pricePosition * 10) / 10,
        currentPrice,
        entryPrice,
        stopLossPrice,
        takeProfitPrice,
        riskReward,
        reason,
        chart,
      };

    } catch (err: any) {
      this.logger.error(`Error evaluando sintético ${sym.symbol}: ${err?.message || err}`);
      return { ...def, reason: 'Error calculando' };
    }
  }
}
