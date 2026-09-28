import { Injectable, Logger } from '@nestjs/common';
import { DerivWebsocketService } from '../deriv/deriv-websocket.service';
import { CandlesService } from '../candles/candles.service';
import {
  calcLongProjectionLevels,
  getSpikeBenchmark,
  calcTypicalM1Size,
  CRASH_BOOM_KNOWN_SYMBOLS,
} from '../signals/signals.service';

export interface BacktestParams {
  symbol?: string; // 'CRASH500', 'ALL', etc.
  days?: number; // 3, 7, 14, 30
  minStars?: number; // 3 or 4
  onlyViable?: boolean;
}

export interface SimulatedTrade {
  id: string;
  symbol: string;
  mercado: string;
  direction: 'COMPRA' | 'VENTA';
  stars: number;
  entryPrice: number;
  entryTime: number; // epoch
  entryDateStr: string;
  hour: number;
  session: 'MADRUGADA' | 'MANANA' | 'TARDE' | 'NOCHE';
  stopLossPrice: number;
  takeProfitPrice: number;
  exitPrice: number;
  exitTime: number;
  exitDateStr: string;
  durationMin: number;
  result: 'WIN' | 'LOSS';
  pnlPoints: number;
  pnlUsd: number;
  rb: number;
  exitReason: string;
}

export interface HourlyStatItem {
  hour: number;
  label: string;
  total: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netProfit: number;
}

export interface SessionStatItem {
  session: 'MADRUGADA' | 'MANANA' | 'TARDE' | 'NOCHE';
  label: string;
  total: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netProfit: number;
}

export interface SymbolStatItem {
  symbol: string;
  mercado: string;
  total: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netProfit: number;
}

export interface BacktestResult {
  symbol: string;
  days: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netProfitPoints: number;
  netProfitUsd: number;
  totalGainUsd: number;
  totalLossUsd: number;
  profitFactor: number;
  avgDurationMin: number;
  bestHour: HourlyStatItem | null;
  worstHour: HourlyStatItem | null;
  hourlyStats: HourlyStatItem[];
  sessionStats: SessionStatItem[];
  symbolStats: SymbolStatItem[];
  aiRecommendations: string[];
  equityCurve: Array<{ time: string; balance: number }>;
  trades: SimulatedTrade[];
  computedAt: string;
}

interface RawCandle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

// ── Math Helpers ─────────────────────────────────────────────────────────────

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

function bollingerBands(closes: number[], period = 20, stdMult = 2) {
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

function toMarketName(symbol: string): string {
  const up = symbol.toUpperCase();
  if (up.startsWith('CRASH')) return `Crash ${up.replace('CRASH', '')}`;
  if (up.startsWith('BOOM')) return `Boom ${up.replace('BOOM', '')}`;
  return symbol;
}

function getSessionFromHour(h: number): 'MADRUGADA' | 'MANANA' | 'TARDE' | 'NOCHE' {
  if (h >= 0 && h < 6) return 'MADRUGADA';
  if (h >= 6 && h < 12) return 'MANANA';
  if (h >= 12 && h < 18) return 'TARDE';
  return 'NOCHE';
}

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);

  constructor(
    private readonly derivWs: DerivWebsocketService,
    private readonly candlesService: CandlesService,
  ) {}

  /** Lista de símbolos disponibles para backtesting */
  getAvailableSymbols(): Array<{ symbol: string; label: string }> {
    return CRASH_BOOM_KNOWN_SYMBOLS.map((s) => ({
      symbol: s,
      label: toMarketName(s),
    }));
  }

  /**
   * Ejecuta la simulación de Backtesting histórica.
   */
  async runBacktest(params: BacktestParams): Promise<BacktestResult> {
    const requestedSymbol = (params.symbol || 'ALL').toUpperCase();
    const days = Math.min(30, Math.max(1, Number(params.days || 7)));
    const minStars = Math.max(1, Math.min(4, Number(params.minStars || 3)));
    const onlyViable = params.onlyViable !== false;

    const targetSymbols =
      requestedSymbol === 'ALL'
        ? CRASH_BOOM_KNOWN_SYMBOLS
        : [requestedSymbol];

    this.logger.log(
      `🔬 Iniciando Backtesting para ${targetSymbols.join(', ')} (${days} días, minStars=${minStars}, onlyViable=${onlyViable})...`,
    );

    const allTrades: SimulatedTrade[] = [];

    // Ejecutar simulación secuencialmente por símbolo para no saturar CPU/WS
    for (const symbol of targetSymbols) {
      try {
        const symbolTrades = await this.simulateSymbol(symbol, days, minStars, onlyViable);
        allTrades.push(...symbolTrades);
      } catch (err: any) {
        this.logger.warn(`Error simulando ${symbol}: ${err?.message ?? err}`);
      }
    }

    // Ordenar trades cronológicamente
    allTrades.sort((a, b) => a.entryTime - b.entryTime);

    // Calcular estadísticas globales
    const result = this.computeStatistics(
      requestedSymbol,
      days,
      allTrades,
      targetSymbols,
    );

    this.logger.log(
      `✅ Backtesting finalizado: ${result.totalTrades} operaciones simuladas | WinRate: ${result.winRatePct}% | Profit: $${result.netProfitUsd}`,
    );

    return result;
  }

  /**
   * Simula cronológicamente un símbolo sobre velas históricas.
   */
  private async simulateSymbol(
    symbol: string,
    days: number,
    minStars: number,
    onlyViable: boolean,
  ): Promise<SimulatedTrade[]> {
    const isCrash = symbol.toUpperCase().includes('CRASH');
    const isBoom = symbol.toUpperCase().includes('BOOM');
    const direction: 'COMPRA' | 'VENTA' = isCrash ? 'VENTA' : 'COMPRA';
    const benchmark = getSpikeBenchmark(symbol);
    const mercado = toMarketName(symbol);

    // Cantidad de velas necesarias: 1 día = 288 velas de 5M. 7 días = ~2016 velas.
    const count5M = Math.min(5000, Math.max(300, days * 288 + 100));
    const count15M = Math.min(2500, Math.max(100, days * 96 + 50));
    const count1H = Math.min(1000, Math.max(50, days * 24 + 30));
    const count4H = Math.min(500, Math.max(20, days * 6 + 20));

    // Obtener velas históricas (desde DB o Deriv WS)
    const [candles5M, candles15M, candles1H, candles4H] = await Promise.all([
      this.fetchCandlesForBacktest(symbol, 300, count5M),
      this.fetchCandlesForBacktest(symbol, 900, count15M),
      this.fetchCandlesForBacktest(symbol, 3600, count1H),
      this.fetchCandlesForBacktest(symbol, 14400, count4H),
    ]);

    if (candles5M.length < 50) {
      this.logger.warn(`Insuficientes velas 5M para ${symbol}: ${candles5M.length}`);
      return [];
    }

    const trades: SimulatedTrade[] = [];
    let activeTradeUntilEpoch = 0;

    // Iterar sobre las velas de 5M a partir del índice 30
    for (let i = 30; i < candles5M.length - 1; i++) {
      const currentCandle = candles5M[i];

      // Si ya hay un trade en curso en este índice, avanzar
      if (currentCandle.epoch < activeTradeUntilEpoch) {
        continue;
      }

      const window5M = candles5M.slice(0, i + 1);
      const closes5M = window5M.map((c) => c.close);
      const entryPrice = currentCandle.close;

      // ── 1. Filtro Macro 4H (EMA 21) ──────────────────────────────────────
      const window4H = candles4H.filter((c) => c.epoch <= currentCandle.epoch);
      let macroTrendH4Ok = true;
      let macroTrendH4 = 'NEUTRAL';
      if (window4H.length >= 6) {
        const closes4H = window4H.map((c) => c.close);
        const period4H = Math.min(21, Math.max(4, Math.floor(closes4H.length * 0.8)));
        const emaH4Arr = ema(closes4H, period4H);
        const emaH4 = emaH4Arr[emaH4Arr.length - 1];
        const lastClose4H = closes4H[closes4H.length - 1];
        if (isCrash) {
          macroTrendH4 = lastClose4H < emaH4 ? 'BAJISTA' : 'ALCISTA';
          macroTrendH4Ok = macroTrendH4 === 'BAJISTA';
        } else if (isBoom) {
          macroTrendH4 = lastClose4H > emaH4 ? 'ALCISTA' : 'BAJISTA';
          macroTrendH4Ok = macroTrendH4 === 'ALCISTA';
        }
      }

      // ── 2. Filtro Intermedio 15M (EMA 50 & Estructura) ───────────────────
      const window15M = candles15M.filter((c) => c.epoch <= currentCandle.epoch);
      let macroTrendOk = true;
      let structureOk = true;
      if (window15M.length >= 8) {
        const closes15M = window15M.map((c) => c.close);
        const period15M = Math.min(50, Math.max(5, Math.floor(closes15M.length * 0.8)));
        const ema15Arr = ema(closes15M, period15M);
        const ema15 = ema15Arr[ema15Arr.length - 1];
        const lastClose15 = closes15M[closes15M.length - 1];
        if (isCrash) {
          macroTrendOk = lastClose15 < ema15;
          const recentHighs = window15M.slice(-10).map((c) => c.high);
          structureOk = entryPrice <= Math.max(...recentHighs);
        } else if (isBoom) {
          macroTrendOk = lastClose15 > ema15;
          const recentLows = window15M.slice(-10).map((c) => c.low);
          structureOk = entryPrice >= Math.min(...recentLows);
        }
      }

      // ── 3. Gatillo Táctico 5M (RSI, Bollinger, Acumulación) ───────────────
      const rsiVal = rsi(closes5M, 14);
      const bb = bollingerBands(closes5M, 20, 2);
      const bbRange = bb.upper - bb.lower;
      const posInBB = bbRange > 0 ? (entryPrice - bb.lower) / bbRange : 0.5;
      const atrVal = atr(window5M, 14);

      let votes = 0;
      if (isCrash) {
        if (rsiVal >= 55) votes++;
        if (rsiVal >= 68) votes++;
        if (posInBB >= 0.52) votes++;
        const last5 = window5M.slice(-5);
        if (last5.filter((c) => c.close >= c.open).length >= 3) votes++;
      } else if (isBoom) {
        if (rsiVal <= 45) votes++;
        if (rsiVal <= 32) votes++;
        if (posInBB <= 0.48) votes++;
        const last5 = window5M.slice(-5);
        if (last5.filter((c) => c.close <= c.open).length >= 3) votes++;
      }

      const stars = Math.min(4, Math.max(1, Math.round((votes / 4) * 4)));

      // Spike stats en 5M
      const typicalM1 = calcTypicalM1Size(window5M, atrVal);
      const spikeThreshold = Math.max(typicalM1 * 2.2, 0.001);
      let lastSpikeIdx = -1;
      for (let j = window5M.length - 1; j >= 0; j--) {
        const c = window5M[j];
        if (isCrash && c.open - c.close >= spikeThreshold) {
          lastSpikeIdx = j;
          break;
        } else if (isBoom && c.close - c.open >= spikeThreshold) {
          lastSpikeIdx = j;
          break;
        }
      }
      const candlesSinceLastSpike = lastSpikeIdx >= 0 ? window5M.length - 1 - lastSpikeIdx : 10;

      // Viabilidad
      let viable = true;
      if (candlesSinceLastSpike < 2) viable = false;
      else if (!macroTrendH4Ok && window4H.length >= 6) viable = false;
      else if (!macroTrendOk && window15M.length >= 8) viable = false;
      else if (!structureOk) viable = false;
      else if (candlesSinceLastSpike > benchmark * 3.2) viable = false;

      // Aplicar filtros seleccionados por el usuario
      if (stars < minStars) continue;
      if (onlyViable && !viable) continue;

      // ── 4. Calcular Niveles de SL y TP con Proyección ────────────────────
      const window1H = candles1H.filter((c) => c.epoch <= currentCandle.epoch);
      const proj = calcLongProjectionLevels(
        symbol,
        direction,
        entryPrice,
        atrVal,
        window15M,
        window1H,
        window5M,
        window4H,
      );

      const slPrice = proj.sl;
      const tpPrice = proj.tp;
      const rb = proj.rb;

      // ── 5. Simular el Trade hacia el futuro (SL 10 min o Spike Profit) ──
      let tradeResult: 'WIN' | 'LOSS' | null = null;
      let exitPrice = entryPrice;
      let exitTime = currentCandle.epoch;
      let exitReason = 'TIMEOUT_EXPIRED';
      let futureIdx = i + 1;

      // Un spike mide al menos spikeThreshold
      const reactionSpikeThreshold = Math.max(typicalM1 * 2.0, 5.0);

      // Máximo 12 velas (60 minutos) de seguimiento
      const maxFutureIdx = Math.min(candles5M.length, i + 12);

      while (futureIdx < maxFutureIdx) {
        const fCandle = candles5M[futureIdx];
        const elapsedCandles = futureIdx - i;

        if (direction === 'VENTA') {
          // Crash: spike es una caída fuerte
          const maxDropFromEntry = entryPrice - fCandle.low;
          const candleDrop = fCandle.open - fCandle.close;

          // A) TP de proyección estructural alcanzado
          if (fCandle.low <= tpPrice) {
            tradeResult = 'WIN';
            exitPrice = tpPrice;
            exitTime = fCandle.epoch;
            exitReason = 'TAKE_PROFIT_SWING';
            break;
          }

          // B) Spike capturado con ganancia (movimiento brusco a favor)
          if (maxDropFromEntry >= reactionSpikeThreshold || candleDrop >= reactionSpikeThreshold) {
            tradeResult = 'WIN';
            exitPrice = fCandle.low + reactionSpikeThreshold * 0.2; // salida asegurando beneficio del spike
            exitTime = fCandle.epoch;
            exitReason = 'SPIKE_PROFIT_CAPTURED';
            break;
          }

          // C) SL de Emergencia por Precio
          if (fCandle.high >= slPrice) {
            tradeResult = 'LOSS';
            exitPrice = slPrice;
            exitTime = fCandle.epoch;
            exitReason = 'STOP_LOSS_PRECIO';
            break;
          }

          // D) SL por tiempo (10 minutos / 2 velas 5M sin spike)
          if (elapsedCandles >= 2) {
            tradeResult = 'LOSS';
            exitPrice = fCandle.close;
            exitTime = fCandle.epoch;
            exitReason = 'STOP_LOSS_10MIN';
            break;
          }
        } else {
          // Boom: spike es una subida fuerte
          const maxGainFromEntry = fCandle.high - entryPrice;
          const candleGain = fCandle.close - fCandle.open;

          // A) TP de proyección estructural alcanzado
          if (fCandle.high >= tpPrice) {
            tradeResult = 'WIN';
            exitPrice = tpPrice;
            exitTime = fCandle.epoch;
            exitReason = 'TAKE_PROFIT_SWING';
            break;
          }

          // B) Spike capturado con ganancia
          if (maxGainFromEntry >= reactionSpikeThreshold || candleGain >= reactionSpikeThreshold) {
            tradeResult = 'WIN';
            exitPrice = fCandle.high - reactionSpikeThreshold * 0.2;
            exitTime = fCandle.epoch;
            exitReason = 'SPIKE_PROFIT_CAPTURED';
            break;
          }

          // C) SL de Emergencia por Precio
          if (fCandle.low <= slPrice) {
            tradeResult = 'LOSS';
            exitPrice = slPrice;
            exitTime = fCandle.epoch;
            exitReason = 'STOP_LOSS_PRECIO';
            break;
          }

          // D) SL por tiempo (10 minutos / 2 velas 5M sin spike)
          if (elapsedCandles >= 2) {
            tradeResult = 'LOSS';
            exitPrice = fCandle.close;
            exitTime = fCandle.epoch;
            exitReason = 'STOP_LOSS_10MIN';
            break;
          }
        }

        futureIdx++;
      }

      if (!tradeResult) {
        const lastCandle = candles5M[Math.min(futureIdx, candles5M.length - 1)];
        exitPrice = lastCandle.close;
        exitTime = lastCandle.epoch;
        const diff = direction === 'VENTA' ? entryPrice - exitPrice : exitPrice - entryPrice;
        tradeResult = diff > 0 ? 'WIN' : 'LOSS';
        exitReason = 'TIMEOUT_10MIN';
      }

      const pnlPoints =
        direction === 'VENTA'
          ? parseFloat((entryPrice - exitPrice).toFixed(2))
          : parseFloat((exitPrice - entryPrice).toFixed(2));

      // Estimación en USD: $1 punto aprox o factor de lote mínimo (0.2 a 0.5)
      const lotMultiplier = 0.5;
      const pnlUsd = parseFloat((pnlPoints * lotMultiplier).toFixed(2));
      const durationMin = Math.max(5, Math.round((exitTime - currentCandle.epoch) / 60));

      const entryDate = new Date(currentCandle.epoch * 1000);
      const exitDate = new Date(exitTime * 1000);
      const hour = entryDate.getHours();
      const session = getSessionFromHour(hour);

      trades.push({
        id: `${symbol}-${currentCandle.epoch}`,
        symbol,
        mercado,
        direction,
        stars,
        entryPrice: parseFloat(entryPrice.toFixed(2)),
        entryTime: currentCandle.epoch,
        entryDateStr: entryDate.toLocaleString('es-MX', { timeZoneName: 'short' }),
        hour,
        session,
        stopLossPrice: slPrice,
        takeProfitPrice: tpPrice,
        exitPrice: parseFloat(exitPrice.toFixed(2)),
        exitTime,
        exitDateStr: exitDate.toLocaleString('es-MX', { timeZoneName: 'short' }),
        durationMin,
        result: tradeResult,
        pnlPoints,
        pnlUsd,
        rb,
        exitReason,
      });

      // No abrir trades solapados en este índice mientras este trade estuvo activo
      activeTradeUntilEpoch = exitTime;
      i = futureIdx; // saltar la simulación al momento del cierre
    }

    return trades;
  }

  /**
   * Obtiene velas históricas de la BD local o las descarga desde Deriv WebSocket.
   */
  private async fetchCandlesForBacktest(
    symbol: string,
    granularity: number,
    count: number,
  ): Promise<RawCandle[]> {
    try {
      // 1. Intentar obtener de BD local
      const dbCandles = await this.candlesService.findLatest(symbol, granularity, count);
      if (dbCandles && dbCandles.length >= Math.min(count, 1500)) {
        return [...dbCandles]
          .map((c) => ({
            epoch: Number(c.epoch),
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
          }))
          .sort((a, b) => a.epoch - b.epoch);
      }

      // 2. Si no hay suficientes en BD, solicitar a Deriv WebSocket
      this.logger.debug(`Descargando historial para ${symbol} (${granularity}s, count=${count})...`);
      const res: any = await this.derivWs.getCandlesHistory(symbol, granularity, count);
      if (res && res.candles && Array.isArray(res.candles)) {
        const raw = res.candles.map((c: any) => ({
          epoch: Number(c.epoch),
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
        }));
        return raw.sort((a: any, b: any) => a.epoch - b.epoch);
      }

      // Fallback a lo que haya en BD
      return (dbCandles || []).map((c) => ({
        epoch: Number(c.epoch),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      })).sort((a, b) => a.epoch - b.epoch);
    } catch (err: any) {
      this.logger.warn(`Fallo al descargar velas para ${symbol}: ${err?.message}`);
      return [];
    }
  }

  /**
   * Computa métricas, curvas de balance, mapas horarios y conclusiones IA.
   */
  private computeStatistics(
    symbol: string,
    days: number,
    trades: SimulatedTrade[],
    targetSymbols: string[],
  ): BacktestResult {
    const totalTrades = trades.length;
    const wins = trades.filter((t) => t.result === 'WIN').length;
    const losses = trades.filter((t) => t.result === 'LOSS').length;
    const winRatePct = totalTrades > 0 ? parseFloat(((wins / totalTrades) * 100).toFixed(1)) : 0;

    let totalGainUsd = 0;
    let totalLossUsd = 0;
    let netProfitPoints = 0;
    let netProfitUsd = 0;
    let totalDuration = 0;

    const equityCurve: Array<{ time: string; balance: number }> = [];
    let currentBalance = 1000.0; // Balance base $1,000 USD
    equityCurve.push({ time: 'Inicio', balance: currentBalance });

    for (const t of trades) {
      netProfitPoints += t.pnlPoints;
      netProfitUsd += t.pnlUsd;
      totalDuration += t.durationMin;

      if (t.pnlUsd > 0) totalGainUsd += t.pnlUsd;
      else totalLossUsd += Math.abs(t.pnlUsd);

      currentBalance = parseFloat((currentBalance + t.pnlUsd).toFixed(2));
      equityCurve.push({ time: t.exitDateStr, balance: currentBalance });
    }

    const profitFactor =
      totalLossUsd > 0
        ? parseFloat((totalGainUsd / totalLossUsd).toFixed(2))
        : totalGainUsd > 0
        ? 99.99
        : 0;

    const avgDurationMin =
      totalTrades > 0 ? Math.round(totalDuration / totalTrades) : 0;

    // Desglose Horario (0 a 23)
    const hourlyStats: HourlyStatItem[] = [];
    for (let h = 0; h < 24; h++) {
      const hTrades = trades.filter((t) => t.hour === h);
      const hWins = hTrades.filter((t) => t.result === 'WIN').length;
      const hLosses = hTrades.filter((t) => t.result === 'LOSS').length;
      const hRate = hTrades.length > 0 ? parseFloat(((hWins / hTrades.length) * 100).toFixed(1)) : 0;
      const hNet = parseFloat(hTrades.reduce((s, t) => s + t.pnlUsd, 0).toFixed(2));

      hourlyStats.push({
        hour: h,
        label: `${String(h).padStart(2, '0')}:00`,
        total: hTrades.length,
        wins: hWins,
        losses: hLosses,
        winRatePct: hRate,
        netProfit: hNet,
      });
    }

    // Identificar mejor y peor hora (con muestra mínima de 2 trades)
    const activeHours = hourlyStats.filter((h) => h.total >= 2);
    const bestHour = activeHours.length > 0
      ? [...activeHours].sort((a, b) => b.winRatePct - a.winRatePct || b.netProfit - a.netProfit)[0]
      : null;
    const worstHour = activeHours.length > 0
      ? [...activeHours].sort((a, b) => a.winRatePct - b.winRatePct || a.netProfit - b.netProfit)[0]
      : null;

    // Desglose por Sesión
    const sessionsOrder: Array<'MADRUGADA' | 'MANANA' | 'TARDE' | 'NOCHE'> = [
      'MADRUGADA',
      'MANANA',
      'TARDE',
      'NOCHE',
    ];
    const sessionLabels = {
      MADRUGADA: 'Madrugada (00:00 - 06:00)',
      MANANA: 'Mañana (06:00 - 12:00)',
      TARDE: 'Tarde (12:00 - 18:00)',
      NOCHE: 'Noche (18:00 - 24:00)',
    };

    const sessionStats: SessionStatItem[] = sessionsOrder.map((s) => {
      const sTrades = trades.filter((t) => t.session === s);
      const sWins = sTrades.filter((t) => t.result === 'WIN').length;
      const sLosses = sTrades.filter((t) => t.result === 'LOSS').length;
      const sRate = sTrades.length > 0 ? parseFloat(((sWins / sTrades.length) * 100).toFixed(1)) : 0;
      const sNet = parseFloat(sTrades.reduce((acc, t) => acc + t.pnlUsd, 0).toFixed(2));
      return {
        session: s,
        label: sessionLabels[s],
        total: sTrades.length,
        wins: sWins,
        losses: sLosses,
        winRatePct: sRate,
        netProfit: sNet,
      };
    });

    // Desglose por Símbolo
    const symbolStats: SymbolStatItem[] = targetSymbols.map((sym) => {
      const sTrades = trades.filter((t) => t.symbol === sym);
      const sWins = sTrades.filter((t) => t.result === 'WIN').length;
      const sLosses = sTrades.filter((t) => t.result === 'LOSS').length;
      const sRate = sTrades.length > 0 ? parseFloat(((sWins / sTrades.length) * 100).toFixed(1)) : 0;
      const sNet = parseFloat(sTrades.reduce((acc, t) => acc + t.pnlUsd, 0).toFixed(2));
      return {
        symbol: sym,
        mercado: toMarketName(sym),
        total: sTrades.length,
        wins: sWins,
        losses: sLosses,
        winRatePct: sRate,
        netProfit: sNet,
      };
    });

    // ── Generar Recomendaciones de la IA ────────────────────────────────────
    const aiRecommendations: string[] = [];

    // 1. Recomendación por Horario
    const morningStat = sessionStats.find((s) => s.session === 'MANANA');
    const afternoonStat = sessionStats.find((s) => s.session === 'TARDE');

    if (morningStat && afternoonStat && morningStat.total > 0 && afternoonStat.total > 0) {
      if (morningStat.winRatePct > afternoonStat.winRatePct + 10) {
        aiRecommendations.push(
          `☀️ Sesión Mañana Superior: La mañana (06:00 - 12:00) tuvo un Win Rate del ${morningStat.winRatePct}% (+$${morningStat.netProfit}), superando drásticamente a la tarde (${afternoonStat.winRatePct}%, $${afternoonStat.netProfit}). Se aconseja priorizar la operativa matutina.`,
        );
      } else if (afternoonStat.winRatePct > morningStat.winRatePct + 10) {
        aiRecommendations.push(
          `🌆 Sesión Tarde Superior: La tarde (12:00 - 18:00) registró mayor efectividad (${afternoonStat.winRatePct}%) frente a la mañana (${morningStat.winRatePct}%).`,
        );
      }
    }

    if (bestHour) {
      aiRecommendations.push(
        `🏆 Horario Estrella (${bestHour.label}): Registró el pico de efectividad con ${bestHour.winRatePct}% de aciertos y +$${bestHour.netProfit} USD netos.`,
      );
    }

    if (worstHour && worstHour.winRatePct < 40) {
      aiRecommendations.push(
        `⚠️ Zona de Peligro (${worstHour.label}): Registró un Win Rate de apenas ${worstHour.winRatePct}% ($${worstHour.netProfit} USD). Se recomienda pausar entradas durante esta hora para evitar acumulaciones adversas.`,
      );
    }

    // 2. Recomendación por Estrellas
    const trades4Star = trades.filter((t) => t.stars === 4);
    const trades3Star = trades.filter((t) => t.stars === 3);
    if (trades4Star.length >= 3 && trades3Star.length >= 3) {
      const rate4 = ((trades4Star.filter((t) => t.result === 'WIN').length / trades4Star.length) * 100).toFixed(1);
      const rate3 = ((trades3Star.filter((t) => t.result === 'WIN').length / trades3Star.length) * 100).toFixed(1);
      aiRecommendations.push(
        `⭐ Impacto de Estrellas: Las señales de 4★ lograron ${rate4}% de acierto frente a ${rate3}% de las de 3★. Filtrar solo entradas de 4★ aumentará la solidez de tu cuenta.`,
      );
    }

    // 3. Recomendación por Índices
    const bestSymbol = [...symbolStats].filter((s) => s.total >= 3).sort((a, b) => b.winRatePct - a.winRatePct)[0];
    if (bestSymbol) {
      aiRecommendations.push(
        `📈 Índice Más Rentable: ${bestSymbol.mercado} lidera con un Win Rate de ${bestSymbol.winRatePct}% y +$${bestSymbol.netProfit} USD de ganancia.`,
      );
    }

    if (aiRecommendations.length === 0) {
      aiRecommendations.push(
        'El sistema recopiló datos iniciales. Aumenta el rango de días para obtener patrones estadísticos más profundos.',
      );
    }

    return {
      symbol,
      days,
      totalTrades,
      wins,
      losses,
      winRatePct,
      netProfitPoints: parseFloat(netProfitPoints.toFixed(2)),
      netProfitUsd: parseFloat(netProfitUsd.toFixed(2)),
      totalGainUsd: parseFloat(totalGainUsd.toFixed(2)),
      totalLossUsd: parseFloat(totalLossUsd.toFixed(2)),
      profitFactor,
      avgDurationMin,
      bestHour,
      worstHour,
      hourlyStats,
      sessionStats,
      symbolStats,
      aiRecommendations,
      equityCurve,
      trades,
      computedAt: new Date().toISOString(),
    };
  }
}
