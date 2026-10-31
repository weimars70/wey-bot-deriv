import { Injectable, Logger } from '@nestjs/common';
import { CandlesService } from '../candles/candles.service';

// ─── Símbolos conocidos de Crash & Boom ──────────────────────────────────────
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

// ─── Interfaces de resultado ──────────────────────────────────────────────────
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
}

// ─── Helpers de cálculo ───────────────────────────────────────────────────────

/** Calcula ATR(period) sobre las últimas velas */
function calcATR(
  candles: { high: number; low: number; close: number }[],
  period = 14,
): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / Math.min(slice.length, period);
}

/** Encuentra swings (fractales con fuerza `strength`) en un array de velas ordenadas ASC */
function findSwings(
  candles: { high: number; low: number }[],
  strength = 2,
): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = strength; i < candles.length - strength; i++) {
    // Swing high
    const isSwingHigh = candles
      .slice(i - strength, i + strength + 1)
      .every((c, idx) => idx === strength || c.high <= candles[i].high);
    if (isSwingHigh) highs.push(candles[i].high);

    // Swing low
    const isSwingLow = candles
      .slice(i - strength, i + strength + 1)
      .every((c, idx) => idx === strength || c.low >= candles[i].low);
    if (isSwingLow) lows.push(candles[i].low);
  }
  return { highs, lows };
}

@Injectable()
export class EaWeySMCService {
  private readonly logger = new Logger(EaWeySMCService.name);

  // Cache de 30 segundos
  private cacheExpiry = 0;
  private cachedResults: EaWeySMCResult[] = [];

  constructor(private readonly candlesService: CandlesService) {}

  /** Escanea los 10 símbolos secuencialmente (no Promise.all para no sobrecargar la pool DB) */
  async scanAll(): Promise<EaWeySMCResult[]> {
    const now = Date.now();
    if (now < this.cacheExpiry && this.cachedResults.length > 0) {
      return this.cachedResults;
    }

    const results: EaWeySMCResult[] = [];
    for (const entry of CRASH_BOOM_KNOWN_SYMBOLS) {
      const result = await this.evaluateSymbol(entry.symbol, entry.name, entry.direction);
      results.push(result);
    }

    // Ordenar: primero los listos, luego por score descendente
    results.sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? -1 : 1;
      return b.score - a.score;
    });

    this.cachedResults = results;
    this.cacheExpiry = now + 30_000;
    return results;
  }

  private async evaluateSymbol(
    symbol: string,
    name: string,
    direction: 'BUY' | 'SELL',
  ): Promise<EaWeySMCResult> {
    const defaultResult: EaWeySMCResult = {
      symbol,
      name,
      direction,
      ready: false,
      score: 0,
      conditions: {
        htfBias: false,
        htfBiasLabel: 'NEUTRAL',
        hasActiveZone: false,
        hasPullback: false,
        hasChoCH: false,
        inDiscountPremium: false,
        hasRecentSpike: false,
        notExhausted: false,
      },
      pricePosition: 50,
      currentPrice: 0,
      reason: 'Error calculando',
    };

    try {
      // 1. Obtener velas M5 (300) y H1 (150)
      // granularity M5 = 300s, H1 = 3600s
      const [m5CandlesRaw, h1CandlesRaw] = await Promise.all([
        this.candlesService.findLatest(symbol, 300, 300),
        this.candlesService.findLatest(symbol, 3600, 150),
      ]);

      // findLatest devuelve orden DESC → invertir para tener ASC
      const m5 = [...m5CandlesRaw].reverse().map((c) => ({
        open:  Number(c.open),
        high:  Number(c.high),
        low:   Number(c.low),
        close: Number(c.close),
        epoch: Number(c.epoch),
      }));
      const h1 = [...h1CandlesRaw].reverse().map((c) => ({
        open:  Number(c.open),
        high:  Number(c.high),
        low:   Number(c.low),
        close: Number(c.close),
        epoch: Number(c.epoch),
      }));

      if (m5.length < 30 || h1.length < 6) {
        return { ...defaultResult, reason: 'Datos insuficientes' };
      }

      const currentPrice = m5[m5.length - 1].close;

      // 2. ATR(14) en M5
      const atr = calcATR(m5, 14);
      if (atr === 0) {
        return { ...defaultResult, currentPrice, reason: 'ATR cero' };
      }

      // 3. Sesgo HTF H1 — fractal con fuerza 2
      const { highs: h1Highs, lows: h1Lows } = findSwings(h1, 2);

      let htfBias: boolean;
      let htfBiasLabel: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL';
      const h1LastClose = h1[h1.length - 1].close;

      if (h1Highs.length >= 2 && h1Lows.length >= 2) {
        const hhOk = h1Highs[h1Highs.length - 1] > h1Highs[h1Highs.length - 2]; // HH
        const hlOk = h1Lows[h1Lows.length - 1]  > h1Lows[h1Lows.length - 2];   // HL
        const lhOk = h1Highs[h1Highs.length - 1] < h1Highs[h1Highs.length - 2]; // LH
        const llOk = h1Lows[h1Lows.length - 1]  < h1Lows[h1Lows.length - 2];   // LL

        if (hhOk && hlOk && h1LastClose > h1Lows[h1Lows.length - 1]) {
          htfBiasLabel = 'ALCISTA';
        } else if (lhOk && llOk && h1LastClose < h1Highs[h1Highs.length - 1]) {
          htfBiasLabel = 'BAJISTA';
        } else {
          htfBiasLabel = 'NEUTRAL';
        }
      } else {
        htfBiasLabel = 'NEUTRAL';
      }

      // Sesgo ok si está alineado con la dirección o es neutral
      if (direction === 'BUY') {
        htfBias = htfBiasLabel === 'ALCISTA' || htfBiasLabel === 'NEUTRAL';
      } else {
        htfBias = htfBiasLabel === 'BAJISTA' || htfBiasLabel === 'NEUTRAL';
      }

      // 4. Rango de las últimas 90 velas M5 → posición porcentual actual
      const range90 = m5.slice(-90);
      const rangeHigh = Math.max(...range90.map((c) => c.high));
      const rangeLow  = Math.min(...range90.map((c) => c.low));
      const rangeSize = rangeHigh - rangeLow;
      const pricePosition = rangeSize > 0
        ? ((currentPrice - rangeLow) / rangeSize) * 100
        : 50;

      // Descuento (Boom en 60% inferior) / Premium (Crash en 60% superior)
      const inDiscountPremium = direction === 'BUY'
        ? pricePosition <= 60
        : pricePosition >= 40;

      // 5. Recorrido ≤ 45%: precio no debe haber recorrido más del 45% del rango
      const notExhausted = direction === 'BUY'
        ? pricePosition <= 45
        : pricePosition >= 55;

      // 6. Zona SMC activa
      // Buscar swings M5 con tolerancia 0.25×ATR, agrupar y contar rebotes ≥ 0.5×ATR
      const { highs: m5Highs, lows: m5Lows } = findSwings(m5, 2);
      const zoneToleranceATR = 0.25 * atr;
      const reactionMinATR   = 0.5  * atr;

      // Crear zonas candidatas combinando highs y lows
      const candidatePrices = [...m5Highs, ...m5Lows];
      const zones: { price: number; reactions: number }[] = [];

      for (const zonePrice of candidatePrices) {
        // Evitar zonas duplicadas
        const alreadyGrouped = zones.find(
          (z) => Math.abs(z.price - zonePrice) <= zoneToleranceATR,
        );
        if (alreadyGrouped) {
          alreadyGrouped.price = (alreadyGrouped.price + zonePrice) / 2;
          continue;
        }
        // Contar reacciones: swings que tocaron la zona con rebote ≥ reactionMinATR
        let reactions = 0;
        for (const c of m5) {
          const touchedHigh = Math.abs(c.high - zonePrice) <= zoneToleranceATR;
          const touchedLow  = Math.abs(c.low  - zonePrice) <= zoneToleranceATR;
          if (touchedHigh || touchedLow) {
            const bounce = Math.abs(c.close - zonePrice);
            if (bounce >= reactionMinATR) reactions++;
          }
        }
        zones.push({ price: zonePrice, reactions });
      }

      // Zona activa: ≥3 reacciones y cercana al precio actual (dentro de 5×ATR)
      const activeZone = zones
        .filter((z) => z.reactions >= 3 && Math.abs(z.price - currentPrice) <= 5 * atr)
        .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))[0];

      const hasActiveZone = !!activeZone;

      // 7. Pullback hacia la zona
      let hasPullback = false;
      if (hasActiveZone) {
        const last30 = m5.slice(-30);
        const zonePrice = activeZone.price;
        const isTowardZone = (c: { open: number; close: number }): boolean =>
          direction === 'BUY'
            ? c.close < c.open   // velas bajistas acercan al soporte (Boom)
            : c.close > c.open;  // velas alcistas acercan a la resistencia (Crash)

        const directionalCandles = last30.filter(isTowardZone).length;
        const directionalPct = (directionalCandles / last30.length) * 100;
        const totalMove = Math.abs(last30[last30.length - 1].close - last30[0].open);

        hasPullback = directionalPct >= 60 && totalMove >= 1.5 * atr;
      }

      // 8. CHoCH simplificado: en las últimas 15 velas M5, hubo un cierre que rompió el swing intermedio
      let hasChoCH = false;
      const last15 = m5.slice(-15);
      if (last15.length >= 5) {
        // Determinar swing intermedio de referencia
        const midSwingHighs = last15.slice(0, -3).map((c) => c.high);
        const midSwingLows  = last15.slice(0, -3).map((c) => c.low);
        const midHigh = Math.max(...midSwingHighs);
        const midLow  = Math.min(...midSwingLows);

        const lastClose = last15[last15.length - 1].close;
        if (direction === 'BUY' && lastClose > midHigh) hasChoCH = true;
        if (direction === 'SELL' && lastClose < midLow) hasChoCH = true;

        // También detectar vela de rechazo: mecha ≥35% del rango y cierre fuera de zona activa
        if (!hasChoCH && hasActiveZone) {
          const lastCandle = last15[last15.length - 1];
          const candleRange = lastCandle.high - lastCandle.low;
          if (candleRange > 0) {
            const wickUp   = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
            const wickDown = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
            const zonePrice = activeZone.price;
            const touchedZone =
              Math.abs(lastCandle.low - zonePrice) <= zoneToleranceATR ||
              Math.abs(lastCandle.high - zonePrice) <= zoneToleranceATR;

            if (touchedZone) {
              if (direction === 'BUY'  && wickDown / candleRange >= 0.35 && lastCandle.close > zonePrice) hasChoCH = true;
              if (direction === 'SELL' && wickUp   / candleRange >= 0.35 && lastCandle.close < zonePrice) hasChoCH = true;
            }
          }
        }
      }

      // 9. Spike reciente: vela M5 con rango ≥ 3×ATR en las últimas 36 velas (~3h)
      const last36 = m5.slice(-36);
      const hasRecentSpike = last36.some((c) => c.high - c.low >= 3 * atr);

      // 10. Compilar score (0-7 condiciones)
      const conditions: EaWeySMCConditions = {
        htfBias,
        htfBiasLabel,
        hasActiveZone,
        hasPullback,
        hasChoCH,
        inDiscountPremium,
        hasRecentSpike,
        notExhausted,
      };

      const score = Object.values(conditions).filter((v) => v === true).length;
      const ready = score >= 6 && htfBias && hasActiveZone && hasPullback && hasChoCH && inDiscountPremium;

      // 11. Razón
      let reason = '';
      if (ready) {
        reason = `✅ ${score}/7 condiciones · Sesgo ${htfBiasLabel} · Zona activa con ${activeZone?.reactions ?? 0} reacciones`;
      } else {
        const missing: string[] = [];
        if (!htfBias)           missing.push(`sesgo H1 ${htfBiasLabel}`);
        if (!hasActiveZone)     missing.push('sin zona SMC activa');
        if (!hasPullback)       missing.push('pullback insuficiente');
        if (!hasChoCH)          missing.push('sin CHoCH/rechazo');
        if (!inDiscountPremium) missing.push(direction === 'BUY' ? 'precio muy alto' : 'precio muy bajo');
        if (!hasRecentSpike)    missing.push('sin spike reciente');
        if (!notExhausted)      missing.push('recorrido >45%');
        reason = `⏳ Esperando: ${missing.join(', ')}`;
      }

      return {
        symbol,
        name,
        direction,
        ready,
        score,
        conditions,
        pricePosition: Math.round(pricePosition * 10) / 10,
        currentPrice,
        reason,
      };
    } catch (err: any) {
      this.logger.error(`Error evaluando ${symbol}: ${err?.message ?? err}`);
      return { ...defaultResult, reason: 'Error calculando' };
    }
  }
}
