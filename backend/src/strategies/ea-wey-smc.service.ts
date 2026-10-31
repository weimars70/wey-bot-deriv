import { Injectable, Logger } from '@nestjs/common';
import { CandlesService } from '../candles/candles.service';

// ─── Símbolos ──────────────────────────────────────────────────────────────────
export const CRASH_BOOM_KNOWN_SYMBOLS = [
  { symbol: 'CRASH300N', name: 'Crash 300', direction: 'SELL' as const },
  { symbol: 'CRASH500',  name: 'Crash 500', direction: 'SELL' as const },
  { symbol: 'CRASH600',  name: 'Crash 600', direction: 'SELL' as const },
  { symbol: 'CRASH900',  name: 'Crash 900', direction: 'SELL' as const },
  { symbol: 'CRASH1000', name: 'Crash 1000', direction: 'SELL' as const },
  { symbol: 'BOOM300N',  name: 'Boom 300',  direction: 'BUY' as const },
  { symbol: 'BOOM500',   name: 'Boom 500',  direction: 'BUY' as const },
  { symbol: 'BOOM600',   name: 'Boom 600',  direction: 'BUY' as const },
  { symbol: 'BOOM900',   name: 'Boom 900',  direction: 'BUY' as const },
  { symbol: 'BOOM1000',  name: 'Boom 1000', direction: 'BUY' as const },
];

// ─── Tipos del gráfico ────────────────────────────────────────────────────────

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
  type: 'REACTION' | 'TREND_PULLBACK';
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
  type: 'CHOCH' | 'REJECTION' | 'SPIKE_RETRACEMENT' | 'CONTINUATION';
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

export interface EaWeySMCConditions {
  htfBias: boolean;
  htfBiasLabel: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL';
  hasActiveZone: boolean;
  hasPullback: boolean;
  hasChoCH: boolean;
  inDiscountPremium: boolean;
  hasRecentSpike: boolean;
  notExhausted: boolean;
}

export interface EaWeySMCResult {
  symbol: string;
  name: string;
  direction: 'BUY' | 'SELL';
  ready: boolean;
  score: number;
  conditions: EaWeySMCConditions;
  pricePosition: number;
  currentPrice: number;
  reason: string;
  chart: ChartData;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

interface CandleRaw { high: number; low: number; close: number; open: number; epoch: number; }

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

function findFVGs(candles: CandleRaw[], atr: number, minAtr = 0.15): FvgZone[] {
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

function findOBs(candles: CandleRaw[], atr: number, dispAtr = 0.7, minLeg = 1.0): ObZone[] {
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

function buildSmcZone(candles: CandleRaw[], direction: 'BUY' | 'SELL', highIdxs: number[], lowIdxs: number[], atr: number): SmcZone | null {
  const tol = 0.25 * atr;
  const minBounce = 0.5 * atr;
  const pivotIdxs = direction === 'BUY' ? lowIdxs : highIdxs;
  const lookback = Math.min(300, candles.length - 1);

  const groups: { center: number; reactions: number; oldestIdx: number }[] = [];
  for (const idx of pivotIdxs) {
    if (idx < 14 || idx > lookback) continue;
    const price = direction === 'BUY' ? candles[idx].low : candles[idx].high;
    const slice8 = candles.slice(Math.max(0, idx - 8), idx);
    const maxNext = slice8.length ? Math.max(...slice8.map(c => c.high)) : price + minBounce;
    const minNext = slice8.length ? Math.min(...slice8.map(c => c.low))  : price - minBounce;
    const bounce = direction === 'BUY' ? maxNext - price : price - minNext;
    if (bounce < minBounce) continue;
    const existing = groups.find(g => Math.abs(g.center - price) <= tol);
    if (existing) { existing.reactions++; existing.center = (existing.center + price) / 2; existing.oldestIdx = Math.max(existing.oldestIdx, idx); }
    else groups.push({ center: price, reactions: 1, oldestIdx: idx });
  }

  const currentPrice = candles[candles.length - 1].close;
  const valid = groups.filter(g => g.reactions >= 3 && Math.abs(g.center - currentPrice) <= 8 * atr)
    .sort((a, b) => Math.abs(a.center - currentPrice) - Math.abs(b.center - currentPrice));

  if (!valid.length) return null;
  const best = valid[0];
  const top = best.center + tol; const bottom = best.center - tol;

  // CHoCH / Rechazo
  const last15 = candles.slice(-15);
  const midHigh = Math.max(...last15.slice(0, -3).map(c => c.high));
  const midLow  = Math.min(...last15.slice(0, -3).map(c => c.low));
  const lastClose = last15[last15.length - 1].close;

  let chochLevel: number | null = null;
  let status: SmcZone['status'] = 'WAITING_TOUCH';

  if (direction === 'BUY'  && lastClose > midHigh) { chochLevel = midHigh; status = 'CHOCH_CONFIRMED'; }
  if (direction === 'SELL' && lastClose < midLow)  { chochLevel = midLow;  status = 'CHOCH_CONFIRMED'; }

  if (!chochLevel) {
    const lc = candles[candles.length - 1];
    const range = lc.high - lc.low;
    if (range > 0) {
      const wDown = Math.min(lc.open, lc.close) - lc.low;
      const wUp   = lc.high - Math.max(lc.open, lc.close);
      const touched = Math.abs(lc.low - best.center) <= tol || Math.abs(lc.high - best.center) <= tol;
      if (touched) {
        if (direction === 'BUY'  && wDown / range >= 0.35) { chochLevel = best.center; status = 'REJECTION'; }
        if (direction === 'SELL' && wUp   / range >= 0.35) { chochLevel = best.center; status = 'REJECTION'; }
      }
    }
  }

  if (status === 'WAITING_TOUCH') {
    const last30 = candles.slice(-30);
    const dc = last30.filter(c => direction === 'BUY' ? c.close < c.open : c.close > c.open).length;
    const mv = Math.abs(last30[last30.length - 1].close - last30[0].open);
    if ((dc / last30.length) >= 0.6 && mv >= 1.5 * atr) status = 'PULLBACK_OK';
  }

  return { top, bottom, center: best.center, direction, reactions: best.reactions, type: 'REACTION', startTime: candles[best.oldestIdx].epoch, status, chochLevel };
}

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable()
export class EaWeySMCService {
  private readonly logger = new Logger(EaWeySMCService.name);

  private cacheExpiry = 0;
  private cachedResults: EaWeySMCResult[] = [];
  private chartCacheExpiry = new Map<string, number>();
  private chartCacheData   = new Map<string, ChartData>();

  constructor(private readonly candlesService: CandlesService) {}

  async scanAll(): Promise<EaWeySMCResult[]> {
    const now = Date.now();
    if (now < this.cacheExpiry && this.cachedResults.length > 0) return this.cachedResults;
    const results: EaWeySMCResult[] = [];
    for (const e of CRASH_BOOM_KNOWN_SYMBOLS)
      results.push(await this.evaluateSymbol(e.symbol, e.name, e.direction));
    results.sort((a, b) => a.ready !== b.ready ? (a.ready ? -1 : 1) : b.score - a.score);
    this.cachedResults = results;
    this.cacheExpiry = now + 30_000;
    return results;
  }

  async getChartData(symbol: string): Promise<ChartData | null> {
    const now = Date.now();
    if (this.chartCacheData.has(symbol) && (this.chartCacheExpiry.get(symbol) ?? 0) > now)
      return this.chartCacheData.get(symbol)!;
    const entry = CRASH_BOOM_KNOWN_SYMBOLS.find(e => e.symbol === symbol);
    if (!entry) return null;
    const result = await this.evaluateSymbol(entry.symbol, entry.name, entry.direction);
    this.chartCacheData.set(symbol, result.chart);
    this.chartCacheExpiry.set(symbol, now + 30_000);
    return result.chart;
  }

  private async evaluateSymbol(symbol: string, name: string, direction: 'BUY' | 'SELL'): Promise<EaWeySMCResult> {
    const empty: ChartData = { candles: [], candlesH1: [], smcZones: [], swingPoints: [], fvgZones: [], obZones: [], htfBiasLine: null, htfSwingHighs: [], htfSwingLows: [], watchLevel: null, entrySignals: [], currentPrice: 0, atr: 0, rangeHigh: 0, rangeLow: 0 };
    const def: EaWeySMCResult = { symbol, name, direction, ready: false, score: 0, conditions: { htfBias: false, htfBiasLabel: 'NEUTRAL', hasActiveZone: false, hasPullback: false, hasChoCH: false, inDiscountPremium: false, hasRecentSpike: false, notExhausted: false }, pricePosition: 50, currentPrice: 0, reason: 'Error', chart: empty };

    try {
      const [m5Raw, h1Raw] = await Promise.all([
        this.candlesService.findLatest(symbol, 300, 300),
        this.candlesService.findLatest(symbol, 3600, 150),
      ]);
      const m5: CandleRaw[] = [...m5Raw].reverse().map(c => ({ open: +c.open, high: +c.high, low: +c.low, close: +c.close, epoch: +c.epoch }));
      const h1: CandleRaw[] = [...h1Raw].reverse().map(c => ({ open: +c.open, high: +c.high, low: +c.low, close: +c.close, epoch: +c.epoch }));

      if (m5.length < 30 || h1.length < 6) return { ...def, reason: 'Datos insuficientes' };

      const currentPrice = m5[m5.length - 1].close;
      const atr = calcATR(m5, 14);
      if (atr === 0) return { ...def, currentPrice, reason: 'ATR cero' };

      // Swings M5
      const { highIdxs, lowIdxs } = findSwingsIndexed(m5, 2);
      const swingPoints = classifySwings(m5, highIdxs, lowIdxs);

      // Sesgo H1
      const h1sw = findSwingsIndexed(h1, 2);
      const h1Highs = h1sw.highIdxs.map(i => h1[i].high);
      const h1Lows  = h1sw.lowIdxs.map(i  => h1[i].low);
      const h1LC    = h1[h1.length - 1].close;

      let htfBiasLabel: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL' = 'NEUTRAL';
      if (h1Highs.length >= 2 && h1Lows.length >= 2) {
        const hhOk = h1Highs[h1Highs.length - 1] > h1Highs[h1Highs.length - 2];
        const hlOk = h1Lows[h1Lows.length - 1]   > h1Lows[h1Lows.length - 2];
        const lhOk = h1Highs[h1Highs.length - 1] < h1Highs[h1Highs.length - 2];
        const llOk = h1Lows[h1Lows.length - 1]   < h1Lows[h1Lows.length - 2];
        if (hhOk && hlOk && h1LC > h1Lows[h1Lows.length - 1])          htfBiasLabel = 'ALCISTA';
        else if (lhOk && llOk && h1LC < h1Highs[h1Highs.length - 1])   htfBiasLabel = 'BAJISTA';
      }
      const htfBias = direction === 'BUY' ? htfBiasLabel !== 'BAJISTA' : htfBiasLabel !== 'ALCISTA';

      // Rango
      const r90 = m5.slice(-90);
      const rangeHigh = Math.max(...r90.map(c => c.high));
      const rangeLow  = Math.min(...r90.map(c => c.low));
      const rSize = rangeHigh - rangeLow;
      const pricePosition = rSize > 0 ? ((currentPrice - rangeLow) / rSize) * 100 : 50;
      const inDiscountPremium = direction === 'BUY' ? pricePosition <= 60 : pricePosition >= 40;
      const notExhausted      = direction === 'BUY' ? pricePosition <= 45 : pricePosition >= 55;

      // Zona SMC
      const smcZone = buildSmcZone(m5, direction, highIdxs, lowIdxs, atr);
      const hasActiveZone = !!smcZone;

      // Pullback
      const last30 = m5.slice(-30);
      const dc30 = last30.filter(c => direction === 'BUY' ? c.close < c.open : c.close > c.open).length;
      const mv30 = Math.abs(last30[last30.length - 1].close - last30[0].open);
      const hasPullback = hasActiveZone && (dc30 / last30.length) >= 0.6 && mv30 >= 1.5 * atr;

      // CHoCH
      const hasChoCH = !!(smcZone?.status === 'CHOCH_CONFIRMED' || smcZone?.status === 'REJECTION');

      // Spike
      const hasRecentSpike = m5.slice(-36).some(c => c.high - c.low >= 3 * atr);

      // FVG, OB
      const fvgZones = findFVGs(m5, atr);
      const obZones  = findOBs(m5, atr);

      // Señal de entrada
      const entrySignals: EntrySignal[] = [];
      if (hasChoCH && smcZone?.chochLevel != null) {
        const lc = m5[m5.length - 1];
        entrySignals.push({
          time: lc.epoch, price: smcZone.chochLevel, direction,
          type: smcZone.status === 'REJECTION' ? 'REJECTION' : 'CHOCH',
          sl: direction === 'BUY' ? smcZone.chochLevel - 2 * atr : smcZone.chochLevel + 2 * atr,
          tp: direction === 'BUY' ? smcZone.chochLevel + 4 * atr : smcZone.chochLevel - 4 * atr,
        });
      }

      const conditions: EaWeySMCConditions = { htfBias, htfBiasLabel, hasActiveZone, hasPullback, hasChoCH, inDiscountPremium, hasRecentSpike, notExhausted };
      const score = Object.values(conditions).filter(v => v === true).length;
      const ready = score >= 6 && htfBias && hasActiveZone && hasPullback && hasChoCH && inDiscountPremium;

      const missing: string[] = [];
      if (!htfBias)           missing.push(`sesgo H1 ${htfBiasLabel}`);
      if (!hasActiveZone)     missing.push('sin zona SMC activa');
      if (!hasPullback)       missing.push('pullback insuficiente');
      if (!hasChoCH)          missing.push('sin CHoCH/rechazo');
      if (!inDiscountPremium) missing.push(direction === 'BUY' ? 'precio muy alto' : 'precio muy bajo');
      if (!hasRecentSpike)    missing.push('sin spike reciente');
      if (!notExhausted)      missing.push('recorrido >45%');
      const reason = ready
        ? `✅ ${score}/7 · Sesgo ${htfBiasLabel} · Zona ${smcZone?.reactions ?? 0} reacciones`
        : `⏳ Esperando: ${missing.join(', ')}`;

      const chart: ChartData = {
        candles:    m5.map(c => ({ time: c.epoch, open: c.open, high: c.high, low: c.low, close: c.close })),
        candlesH1:  h1.map(c => ({ time: c.epoch, open: c.open, high: c.high, low: c.low, close: c.close })),
        smcZones:   smcZone ? [smcZone] : [],
        swingPoints,
        fvgZones,
        obZones,
        htfBiasLine: h1Lows.length > 0 ? h1Lows[h1Lows.length - 1] : null,
        htfSwingHighs: h1Highs.slice(-2),
        htfSwingLows:  h1Lows.slice(-2),
        watchLevel: smcZone ? smcZone.center : null,
        entrySignals,
        currentPrice, atr, rangeHigh, rangeLow,
      };

      return { symbol, name, direction, ready, score, conditions, pricePosition: Math.round(pricePosition * 10) / 10, currentPrice, reason, chart };

    } catch (err: any) {
      this.logger.error(`Error evaluando ${symbol}: ${err?.message ?? err}`);
      return { ...def, reason: 'Error calculando' };
    }
  }
}
