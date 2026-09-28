import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { CandlesService } from '../candles/candles.service';
import { DerivWebsocketService } from '../deriv/deriv-websocket.service';
import { TradingBotService } from '../trading/trading-bot.service';

export interface RetestZone {
  id: string;
  level: number;
  minPrice: number;
  maxPrice: number;
  spikeCount: number;
  avgDrop: number;
  maxDrop: number;
  lastReactionEpoch: number;
  lastReactionDateStr: string;
  distToCurrentPts: number;
  distToCurrentPct: number;
  isRetestingNow: boolean;
}

export interface CandleDataPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  upperWick?: number;
  lowerWick?: number;
  body?: number;
  isSpike?: boolean;
}

export interface LiveCrash600Evaluation {
  symbol: string;
  timestamp: number;
  dateStr: string;
  currentPrice: number;
  lastSpike: {
    epoch: number;
    dateStr: string;
    dropPoints: number;
    high: number;
    low: number;
    minutesAgo: number;
  } | null;
  candlesM1SinceLastSpike: number;
  greenRunM1: number;
  retracePercent: number;
  isInRetraceZone: boolean;
  ema50M5: number;
  ema21M5: number;
  distToEma50Pct: number;
  isAtEma50: boolean;
  momentumExhausted: boolean;
  upperWickRejection: boolean;
  currentHour: number;
  hourType: 'EXPLOSIVA' | 'NEUTRAL' | 'TRAMPA';
  score: number; // 0..100
  stars: number; // 1..5
  decision: 'VENTA_CONFIRMADA' | 'PREPARANDO_GATILLO' | 'ESPERANDO_ZONA' | 'BLOQUEO_HORA';
  decisionMessage: string;
  recommendedLot: number;
  recommendedSlPrice: number;
  recommendedTpPrice: number;
  timeSlMinutes: number;
  autoTradingActive: boolean;
  // Zonas de retesteo y velas para el gráfico
  retestZones: RetestZone[];
  activeRetestZone: RetestZone | null;
  chartCandles: CandleDataPoint[];
}

export interface SpikeBacktestTrade {
  id: string;
  symbol: string;
  direction: 'VENTA';
  entryPrice: number;
  entryTime: number;
  entryDateStr: string;
  exitPrice: number;
  exitTime: number;
  exitDateStr: string;
  pnlPoints: number;
  pnlUsd: number;
  durationMin: number;
  result: 'WIN' | 'LOSS';
  exitReason: string;
  stars: number;
  // Velas y patrón analizado para el inspector visual
  patternDetected: string;
  hasTwoWicks: boolean;
  hasRetestPattern: boolean;
  retestSpikesCount?: number;
  candlesSnippet: CandleDataPoint[];
}

export interface SpikeBacktestResult {
  symbol: string;
  days: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netProfitUsd: number;
  totalGainUsd: number;
  totalLossUsd: number;
  profitFactor: number;
  trades: SpikeBacktestTrade[];
}

@Injectable()
export class CrashSpikeStrategyService {
  private readonly logger = new Logger(CrashSpikeStrategyService.name);
  private autoTradingActive = false;
  private lastAutoTradeAt = 0;

  // Horas según análisis cuantitativo de índices Crash & Boom
  private readonly EXPLOSIVE_HOURS = [5, 6, 11, 13, 15]; // UTC
  private readonly TRAP_HOURS = [1, 8, 9, 18, 21]; // UTC

  // Índices soportados por la estrategia de patrones spike
  static readonly SUPPORTED_SYMBOLS = [
    'CRASH300N', 'CRASH500', 'CRASH600', 'CRASH900', 'CRASH1000',
    'BOOM300N', 'BOOM500', 'BOOM600', 'BOOM900', 'BOOM1000',
  ];

  /**
   * Retorna los parámetros operativos (umbrales) específicos de cada índice.
   * Los índices con número pequeño (100/200) tienen spikes más grandes.
   * Los de número grande (900/1000) tienen spikes más frecuentes pero pequeños.
   */
  private getSymbolParams(symbol: string): {
    spikeMinDrop: number;     // Caída mínima en pts para clasificar como spike
    tolerancePts: number;     // Tolerancia para agrupar zonas de retesteo
    slPts: number;            // Stop Loss recomendado en pts
    recommendedLot: number;   // Lote por defecto
    greenRunTarget: number;   // Velas M1 de carga objetivo antes del spike
    retraceMin: number;       // Mínimo % de retroceso para Zona V
    retraceMax: number;       // Máximo % de retroceso para Zona V
    direction: 'SELL' | 'BUY'; // Crash = SELL, Boom = BUY
  } {
    const up = (symbol || '').toUpperCase();
    const isBoom = up.includes('BOOM');
    const direction = isBoom ? 'BUY' : 'SELL';

    if (up.includes('100') && !up.includes('1000')) {
      return { spikeMinDrop: 40.0, tolerancePts: 10.0, slPts: 25, recommendedLot: 0.20, greenRunTarget: 10, retraceMin: 38, retraceMax: 65, direction };
    }
    if (up.includes('200')) {
      return { spikeMinDrop: 30.0, tolerancePts: 8.0, slPts: 20, recommendedLot: 0.20, greenRunTarget: 10, retraceMin: 38, retraceMax: 65, direction };
    }
    if (up.includes('300')) {
      return { spikeMinDrop: 20.0, tolerancePts: 6.0, slPts: 15, recommendedLot: 0.25, greenRunTarget: 10, retraceMin: 38, retraceMax: 65, direction };
    }
    if (up.includes('500')) {
      return { spikeMinDrop: 15.0, tolerancePts: 5.0, slPts: 12, recommendedLot: 0.30, greenRunTarget: 10, retraceMin: 38, retraceMax: 65, direction };
    }
    if (up.includes('600')) {
      return { spikeMinDrop: 12.0, tolerancePts: 4.5, slPts: 12, recommendedLot: 0.30, greenRunTarget: 10, retraceMin: 38, retraceMax: 65, direction };
    }
    if (up.includes('900')) {
      return { spikeMinDrop: 10.0, tolerancePts: 4.0, slPts: 10, recommendedLot: 0.40, greenRunTarget: 10, retraceMin: 38, retraceMax: 65, direction };
    }
    if (up.includes('1000')) {
      return { spikeMinDrop: 8.0, tolerancePts: 3.5, slPts: 8, recommendedLot: 0.50, greenRunTarget: 10, retraceMin: 38, retraceMax: 65, direction };
    }
    // Default
    return { spikeMinDrop: 12.0, tolerancePts: 4.5, slPts: 12, recommendedLot: 0.30, greenRunTarget: 10, retraceMin: 38, retraceMax: 65, direction };
  }

  constructor(
    private readonly candlesService: CandlesService,
    private readonly derivWs: DerivWebsocketService,
    @Inject(forwardRef(() => TradingBotService))
    private readonly tradingBotService: TradingBotService,
  ) {
    // Monitoreo automático en vivo cada 5 segundos si el auto-trading está activo
    setInterval(() => {
      this.checkAutoTradeTrigger().catch(() => {});
    }, 5_000);
  }

  isAutoTrading(): boolean {
    return this.autoTradingActive;
  }

  setAutoTrading(active: boolean): boolean {
    this.autoTradingActive = active;
    this.logger.log(`🤖 Auto-Trading para Estrategia Patrones Spike (Todos los Índices): ${active ? 'ACTIVADO' : 'PAUSADO'}`);
    return this.autoTradingActive;
  }

  /**
   * Evaluación en tiempo real de cualquier índice Crash/Boom basada en los 4 patrones matemáticos.
   * Por defecto evalúa CRASH600 para compatibilidad, pero soporta todos los índices.
   */
  async evaluateLiveCrash600(chartGranularity: number = 300, symbol: string = 'CRASH600'): Promise<LiveCrash600Evaluation> {
    // Normalizar símbolo
    symbol = (symbol || 'CRASH600').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!CrashSpikeStrategyService.SUPPORTED_SYMBOLS.includes(symbol)) {
      symbol = 'CRASH600';
    }
    const params = this.getSymbolParams(symbol);

    // 1. Obtener velas recientes en M1 (60s), M5 (300s) y M15 (900s si se solicita)
    const [candlesM1, candlesM5, candlesM15] = await Promise.all([
      this.fetchRecentCandles(symbol, 60, 60),
      this.fetchRecentCandles(symbol, 300, 250),
      chartGranularity === 900 ? this.fetchRecentCandles(symbol, 900, 150) : Promise.resolve([]),
    ]);

    const latestM1 = candlesM1[candlesM1.length - 1];
    const currentPrice = latestM1 ? latestM1.close : 0;

    // 2. Identificar el último spike grande en M1 y M5 (umbral dinámico por símbolo)
    let lastSpikeData: LiveCrash600Evaluation['lastSpike'] = null;
    let spikeIndexM1 = -1;
    const isBoom = params.direction === 'BUY';

    for (let i = candlesM1.length - 1; i >= 0; i--) {
      const c = candlesM1[i];
      // Para Crash: caída = open - low. Para Boom: subida = high - open.
      const drop = isBoom ? (c.high - c.open) : (c.open - c.low);
      if (drop >= params.spikeMinDrop) {
        spikeIndexM1 = i;
        const nowSec = Math.floor(Date.now() / 1000);
        const minsAgo = Math.max(0, Math.round((nowSec - c.epoch) / 60));
        lastSpikeData = {
          epoch: c.epoch,
          dateStr: new Date(c.epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          dropPoints: Number(drop.toFixed(2)),
          high: c.open,
          low: c.low,
          minutesAgo: minsAgo,
        };
        break;
      }
    }

    // 3. Conteo de velas M1 transcurridas y movimiento continuo (al alza para Crash, a la baja para Boom)
    const candlesM1SinceLastSpike = spikeIndexM1 >= 0 ? (candlesM1.length - 1 - spikeIndexM1) : 10;
    let greenRunM1 = 0;
    for (let i = candlesM1.length - 1; i >= 0; i--) {
      const c = candlesM1[i];
      // Para Crash buscamos velas alcistas (carga antes de la caída). Para Boom: velas bajistas.
      const isCarga = isBoom ? (c.close <= c.open && (c.high - c.open) < params.spikeMinDrop * 0.6)
                             : (c.close >= c.open && (c.open - c.low) < params.spikeMinDrop * 0.6);
      if (isCarga) {
        greenRunM1++;
      } else {
        break;
      }
    }

    // 4. Medir el % de retroceso respecto al último spike (Zona V)
    let retracePercent = 0;
    let isInRetraceZone = false;
    if (lastSpikeData && lastSpikeData.dropPoints > 0) {
      const currentMove = isBoom
        ? lastSpikeData.high - currentPrice  // Para Boom: retroceso bajista desde el pico
        : currentPrice - lastSpikeData.low;  // Para Crash: rebote alcista desde el mínimo
      retracePercent = Number(((currentMove / lastSpikeData.dropPoints) * 100).toFixed(1));
      isInRetraceZone = retracePercent >= params.retraceMin && retracePercent <= params.retraceMax;
    }

    // 5. Medir confluencia con EMA 50 y EMA 21 en 5M
    const closesM5 = candlesM5.map((c) => c.close);
    const ema50Arr = this.calcEma(closesM5, 50);
    const ema21Arr = this.calcEma(closesM5, 21);
    const ema50M5 = ema50Arr.length > 0 ? ema50Arr[ema50Arr.length - 1] : currentPrice;
    const ema21M5 = ema21Arr.length > 0 ? ema21Arr[ema21Arr.length - 1] : currentPrice;

    const distToEma50Pct = Number((Math.abs(currentPrice - ema50M5) / (ema50M5 || 1) * 100).toFixed(2));
    const isAtEma50 = distToEma50Pct <= 0.25;

    // 6. Análisis de agotamiento en la vela previa (M5 y M1)
    let momentumExhausted = false;
    let upperWickRejection = false;
    if (candlesM5.length >= 3) {
      const prevM5 = candlesM5[candlesM5.length - 2];
      const prev2M5 = candlesM5[candlesM5.length - 3];
      const prevRange = prevM5.high - prevM5.low;
      const prevUpperWick = prevM5.high - Math.max(prevM5.open, prevM5.close);
      if (prevRange > 0 && (prevUpperWick / prevRange) >= 0.25) {
        upperWickRejection = true;
      }
      const prevBody = Math.abs(prevM5.close - prevM5.open);
      const prev2Body = Math.abs(prev2M5.close - prev2M5.open);
      if (prev2Body > 0 && prevBody < prev2Body * 0.70) {
        momentumExhausted = true;
      }
    }

    // 7. Detección de ZONAS DE RETESTEO (techos/pisos donde el índice reaccionó múltiples veces)
    const retestZones = this.findRetestZones(candlesM5, currentPrice, params.spikeMinDrop, params.tolerancePts, isBoom);
    const activeRetestZone = retestZones.find((z) => z.isRetestingNow) || null;

    // 8. Filtro Horario (Horas de Oro vs Horas Trampa)
    const nowUtcHour = new Date().getUTCHours();
    let hourType: 'EXPLOSIVA' | 'NEUTRAL' | 'TRAMPA' = 'NEUTRAL';
    if (this.EXPLOSIVE_HOURS.includes(nowUtcHour)) {
      hourType = 'EXPLOSIVA';
    } else if (this.TRAP_HOURS.includes(nowUtcHour)) {
      hourType = 'TRAMPA';
    }

    // 9. Cómputo del Score Confluyente (0..100)
    let score = 0;

    // +35 pts si está en RETESTEO ACTIVO de un nivel con múltiples spikes previos
    if (activeRetestZone) {
      if (activeRetestZone.spikeCount >= 3) score += 35;
      else if (activeRetestZone.spikeCount >= 2) score += 25;
    }

    // +25 pts: Retroceso en Zona 38% - 65% del spike previo
    if (isInRetraceZone) score += 25;
    else if (retracePercent >= 30 && retracePercent <= 75) score += 15;

    // +20 pts: Confluencia con EMA 50 en M5 (±0.25%)
    if (isAtEma50) score += 20;
    else if (distToEma50Pct <= 0.50) score += 10;

    // +15 pts: Ciclo de carga de 8 a 12 velas M1 continuas (media 9.9)
    if (greenRunM1 >= 8 && greenRunM1 <= 12) score += 15;
    else if (greenRunM1 >= 6 && greenRunM1 <= 15) score += 10;

    // +10 pts: Agotamiento de momentum o mecha de rechazo
    if (momentumExhausted || upperWickRejection) score += 10;

    // +10 pts por hora explosiva, o -20 pts por hora trampa
    if (hourType === 'EXPLOSIVA') score += 10;
    if (hourType === 'TRAMPA') score = Math.max(0, score - 20);

    // Mapeo a Estrellas (1 a 5)
    let stars = 1;
    if (score >= 85) stars = 5;
    else if (score >= 70) stars = 4;
    else if (score >= 50) stars = 3;
    else if (score >= 35) stars = 2;

    // 10. Determinación de la Decisión
    let decision: LiveCrash600Evaluation['decision'] = 'ESPERANDO_ZONA';
    let decisionMessage = 'Esperando que el precio suba a una zona de retesteo de spikes o retroceso del 50%.';

    if (hourType === 'TRAMPA' && score < 65) {
      decision = 'BLOQUEO_HORA';
      decisionMessage = `Hora UTC ${String(nowUtcHour).padStart(2, '0')}:00 clasificada como HORA TRAMPA (acumulación alcista lenta sin spikes).`;
    } else if (activeRetestZone && activeRetestZone.spikeCount >= 2 && score >= 55) {
      decision = 'VENTA_CONFIRMADA';
      decisionMessage = `🎯 ¡ZONA DE RETESTEO ACTIVA (${activeRetestZone.level} pts)! Ha generado ${activeRetestZone.spikeCount} caídas previas (promedio: -${activeRetestZone.avgDrop} pts). Score: ${score} pts.`;
    } else if (score >= 70) {
      decision = 'VENTA_CONFIRMADA';
      decisionMessage = `¡CONFLUENCIA MÁXIMA (${score} pts)! Zona retroceso (${retracePercent}%), ${greenRunM1} velas M1 de carga y EMA 50.`;
    } else if (activeRetestZone) {
      decision = 'PREPARANDO_GATILLO';
      decisionMessage = `Retesteando zona ${activeRetestZone.level} (${activeRetestZone.spikeCount} spikes previos). Carga M1: ${greenRunM1}/10 velas.`;
    } else if (score >= 40 || isInRetraceZone || isAtEma50) {
      decision = 'PREPARANDO_GATILLO';
      decisionMessage = `En zona de reacción (${retracePercent}% retroceso). Esperando conteo de carga (llevamos ${greenRunM1}/10 velas M1).`;
    }

    // Proyecciones (dinámicas según símbolo y dirección)
    const recommendedLot = params.recommendedLot;
    const recommendedSlPrice = isBoom
      ? Number((currentPrice - params.slPts).toFixed(3))
      : Number((currentPrice + params.slPts).toFixed(3));
    const targetDrop = activeRetestZone ? activeRetestZone.avgDrop : (lastSpikeData ? Math.max(params.spikeMinDrop * 2, lastSpikeData.dropPoints * 0.8) : params.spikeMinDrop * 3);
    const recommendedTpPrice = isBoom
      ? Number((currentPrice + targetDrop).toFixed(3))
      : Number((currentPrice - targetDrop).toFixed(3));

    // Mapeo de velas para el gráfico (últimas 120 velas según temporalidad M5 o M15)
    const displayCandles = chartGranularity === 900 && candlesM15.length > 0 ? candlesM15 : candlesM5;
    const chartCandles: CandleDataPoint[] = displayCandles.slice(-120).map((c) => {
      const open = Number(c.open);
      const high = Number(c.high);
      const low = Number(c.low);
      const close = Number(c.close);
      const upperWick = Number((high - Math.max(open, close)).toFixed(2));
      const lowerWick = Number((Math.min(open, close) - low).toFixed(2));
      const body = Number(Math.abs(close - open).toFixed(2));
      const isSpike = isBoom ? (high - open) >= params.spikeMinDrop : (open - low) >= params.spikeMinDrop;
      return {
        time: Number(c.epoch),
        open,
        high,
        low,
        close,
        upperWick,
        lowerWick,
        body,
        isSpike,
      };
    });

    return {
      symbol,
      timestamp: Math.floor(Date.now() / 1000),
      dateStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      currentPrice,
      lastSpike: lastSpikeData,
      candlesM1SinceLastSpike,
      greenRunM1,
      retracePercent,
      isInRetraceZone,
      ema50M5,
      ema21M5,
      distToEma50Pct,
      isAtEma50,
      momentumExhausted,
      upperWickRejection,
      currentHour: nowUtcHour,
      hourType,
      score,
      stars,
      decision,
      decisionMessage,
      recommendedLot,
      recommendedSlPrice,
      recommendedTpPrice,
      timeSlMinutes: 10,
      autoTradingActive: this.autoTradingActive,
      retestZones: retestZones.slice(0, 8),
      activeRetestZone,
      chartCandles,
    };
  }

  /**
   * Ejecuta inmediatamente una operación (SELL para Crash, BUY para Boom) en MetaTrader 5.
   */
  async executeCrash600Trade(customLot?: number, symbol: string = 'CRASH600') {
    symbol = (symbol || 'CRASH600').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!CrashSpikeStrategyService.SUPPORTED_SYMBOLS.includes(symbol)) symbol = 'CRASH600';
    const params = this.getSymbolParams(symbol);

    const evalData = await this.evaluateLiveCrash600(300, symbol);
    const lot = customLot || evalData.recommendedLot || params.recommendedLot;

    this.logger.log(
      `⚡ [ORDEN SPIKE ${symbol}] Disparando ${params.direction} en MetaTrader 5. Precio: ${evalData.currentPrice}, Lote: ${lot}, Score: ${evalData.score} pts.`,
    );

    const trade = await this.tradingBotService.executeManualTrade({
      symbol,
      direction: params.direction,
      lot,
      stopLossPrice: evalData.recommendedSlPrice,
      takeProfitPrice: evalData.recommendedTpPrice,
    });

    this.lastAutoTradeAt = Date.now();
    return {
      ok: true,
      trade,
      evaluation: evalData,
    };
  }

  /**
   * Ciclo automático: Si AutoTrading está activo y el score >= 70, entra automáticamente en Crash 600.
   */
  private async checkAutoTradeTrigger() {
    if (!this.autoTradingActive) return;

    // Cooldown mínimo de 15 minutos entre entradas automáticas
    if (Date.now() - this.lastAutoTradeAt < 15 * 60 * 1000) {
      return;
    }

    const evalData = await this.evaluateLiveCrash600(300, 'CRASH600');
    if (evalData.decision === 'VENTA_CONFIRMADA' && evalData.score >= 70) {
      this.logger.log(`🤖 [AUTO-TRADING TRIGGER] Entrada automática disparada en ${evalData.symbol} (Score: ${evalData.score})`);
      await this.executeCrash600Trade(evalData.recommendedLot, evalData.symbol);
    }
  }

  /**
   * Backtesting del Patrón Pre-Spike escalable hasta 100 días.
   */
  async runBacktest(days: number = 30, minScore: number = 65, symbol: string = 'CRASH600'): Promise<SpikeBacktestResult> {
    symbol = (symbol || 'CRASH600').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!CrashSpikeStrategyService.SUPPORTED_SYMBOLS.includes(symbol)) symbol = 'CRASH600';
    const params = this.getSymbolParams(symbol);
    const count5M = Math.min(28800, Math.max(300, days * 288 + 50)); // 100 días = ~28,800 velas 5M

    this.logger.log(`Iniciando Backtest de Patrones Spike en ${symbol} (${days} días, ~${count5M} velas)...`);

    // Descarga con paginación
    const candles5M = await this.fetchHistoricalCandlesPaginated(symbol, 300, count5M);
    if (candles5M.length < 50) {
      throw new Error(`Velas insuficientes para backtest: ${candles5M.length}`);
    }

    const closes5M = candles5M.map((c) => c.close);
    const ema50Arr = this.calcEma(closes5M, 50);

    const trades: SpikeBacktestTrade[] = [];
    let lastSpikeLow = 0;
    let lastSpikeHigh = 0;
    let lastSpikeDrop = 0;
    let cooldownUntilIdx = 0;
    const isBoom = params.direction === 'BUY';

    for (let i = 25; i < candles5M.length - 3; i++) {
      if (i < cooldownUntilIdx) continue;

      const c = candles5M[i];
      const candleDrop = isBoom ? (c.high - c.open) : (c.open - c.low);

      // Registrar último spike previo para medir retroceso
      if (candleDrop >= params.spikeMinDrop) {
        lastSpikeLow = c.low;
        lastSpikeHigh = c.high;
        lastSpikeDrop = candleDrop;
      }

      // Evaluar condición de entrada en vela i
      let score = 0;
      let retracePct = 0;
      if (lastSpikeDrop > 0) {
        const retrace = isBoom ? (lastSpikeHigh - c.close) : (c.close - lastSpikeLow);
        retracePct = (retrace / lastSpikeDrop) * 100;
        if (retracePct >= params.retraceMin && retracePct <= params.retraceMax) score += 35;
      }

      const ema50 = ema50Arr[i] || c.close;
      const distEma50Pct = Math.abs(c.close - ema50) / ema50 * 100;
      if (distEma50Pct <= 0.25) score += 25;

      // Conteo de velas verdes 5M previas
      let greenM5 = 0;
      for (let k = i - 1; k >= Math.max(0, i - 5); k--) {
        if (candles5M[k].close >= candles5M[k].open) greenM5++;
        else break;
      }
      if (greenM5 >= 2 && greenM5 <= 4) score += 20;

      // Agotamiento de vela previa
      const prev = candles5M[i - 1];
      const prev2 = candles5M[i - 2];
      if (prev && prev2) {
        const prevBody = Math.abs(prev.close - prev.open);
        const prev2Body = Math.abs(prev2.close - prev2.open);
        if (prev2Body > 0 && prevBody < prev2Body * 0.7) score += 10;
      }

      // Filtro horario
      const hour = new Date(c.epoch * 1000).getUTCHours();
      if (this.EXPLOSIVE_HOURS.includes(hour)) score += 10;
      if (this.TRAP_HOURS.includes(hour)) score -= 20;

      // ¿Entrada califica?
      if (score >= minScore) {
        const entryPrice = c.close;
        const entryTime = c.epoch;
        let exitPrice = entryPrice;
        let exitTime = entryTime;
        let result: 'WIN' | 'LOSS' = 'LOSS';
        let exitReason = 'STOP_LOSS_10MIN';

        // Evaluar las siguientes 2 velas M5 (10 minutos)
        for (let step = 1; step <= 2; step++) {
          const fc = candles5M[i + step];
          if (!fc) break;
          const futureDrop = entryPrice - fc.low;

          // Spike capturado (umbral dinámico)
          const futureSpike = isBoom ? (fc.high - entryPrice) : (entryPrice - fc.low);
          if (futureSpike >= params.spikeMinDrop) {
            result = 'WIN';
            exitPrice = isBoom ? (fc.high - 3.0) : (fc.low + 3.0);
            exitTime = fc.epoch;
            exitReason = 'SPIKE_PROFIT_CAPTURED';
            break;
          }

          // Salida al final de 10 min
          if (step === 2) {
            exitPrice = fc.close;
            exitTime = fc.epoch;
            exitReason = 'STOP_LOSS_10MIN';
            result = (entryPrice - exitPrice) >= 5.0 ? 'WIN' : 'LOSS';
          }
        }

        const pnlPoints = Number((entryPrice - exitPrice).toFixed(2));
        const lot = 0.30;
        const pnlUsd = Number((pnlPoints * lot).toFixed(2));
        const durationMin = Math.max(5, Math.round((exitTime - entryTime) / 60));

        // Snippet de velas alrededor del trade para inspección visual
        const startSnippetIdx = Math.max(0, i - 6);
        const endSnippetIdx = Math.min(candles5M.length - 1, i + 3);
        const candlesSnippet: CandleDataPoint[] = candles5M.slice(startSnippetIdx, endSnippetIdx + 1).map((sc) => {
          const open = Number(sc.open);
          const high = Number(sc.high);
          const low = Number(sc.low);
          const close = Number(sc.close);
          const upperWick = Number((high - Math.max(open, close)).toFixed(2));
          const lowerWick = Number((Math.min(open, close) - low).toFixed(2));
          const body = Number(Math.abs(close - open).toFixed(2));
          const isSpike = isBoom ? (high - open) >= params.spikeMinDrop : (open - low) >= params.spikeMinDrop;
          return {
            time: Number(sc.epoch),
            open,
            high,
            low,
            close,
            upperWick,
            lowerWick,
            body,
            isSpike,
          };
        });

        // Detección de Patrón 2 Velas con Mecha Superior (Crash) o Mecha Inferior (Boom)
        const prev1 = candles5M[i - 1];
        const prev2 = candles5M[i - 2];
        const wick1 = isBoom
          ? (prev1 ? (Math.min(prev1.open, prev1.close) - prev1.low) / (prev1.high - prev1.low || 1) : 0)
          : (prev1 ? (prev1.high - Math.max(prev1.open, prev1.close)) / (prev1.high - prev1.low || 1) : 0);
        const wick2 = isBoom
          ? (prev2 ? (Math.min(prev2.open, prev2.close) - prev2.low) / (prev2.high - prev2.low || 1) : 0)
          : (prev2 ? (prev2.high - Math.max(prev2.open, prev2.close)) / (prev2.high - prev2.low || 1) : 0);
        const hasTwoWicks = wick1 >= 0.25 && wick2 >= 0.25;

        // Detección de Retesteo de Zona de Spikes previos (últimas 150 velas)
        let retestSpikesCount = 0;
        for (let sIdx = Math.max(0, i - 150); sIdx < i; sIdx++) {
          const sc = candles5M[sIdx];
          const scDrop = isBoom ? (sc.high - sc.open) : (sc.open - sc.low);
          const scLevel = isBoom ? sc.open : sc.open;
          if (scDrop >= params.spikeMinDrop && Math.abs(scLevel - entryPrice) <= params.tolerancePts) {
            retestSpikesCount++;
          }
        }
        const hasRetestPattern = retestSpikesCount >= 2;

        let patternDetected = 'Retroceso Zona V 50%';
        if (hasTwoWicks && hasRetestPattern) {
          patternDetected = `🎯 2 Velas con Mecha + Retesteo (${retestSpikesCount} Spikes)`;
        } else if (hasTwoWicks) {
          patternDetected = '🔥 Estrategia 2 Velas con Mecha Superior';
        } else if (hasRetestPattern) {
          patternDetected = `🎯 Retesteo de Zona (${retestSpikesCount} Spikes previos)`;
        } else if (distEma50Pct <= 0.25) {
          patternDetected = '🧲 Rebote en Resistencia EMA 50';
        }

        trades.push({
          id: `BT-${symbol}-${entryTime}`,
          symbol,
          direction: 'VENTA',
          entryPrice,
          entryTime,
          entryDateStr: new Date(entryTime * 1000).toLocaleString('es-MX', { timeZoneName: 'short' }),
          exitPrice,
          exitTime,
          exitDateStr: new Date(exitTime * 1000).toLocaleString('es-MX', { timeZoneName: 'short' }),
          pnlPoints,
          pnlUsd,
          durationMin,
          result,
          exitReason,
          stars: score >= 85 ? 5 : score >= 70 ? 4 : 3,
          patternDetected,
          hasTwoWicks,
          hasRetestPattern,
          retestSpikesCount,
          candlesSnippet,
        });

        cooldownUntilIdx = i + 3; // Cooldown de 15 minutos tras el trade
      }
    }

    const wins = trades.filter((t) => t.result === 'WIN').length;
    const losses = trades.length - wins;
    const winRatePct = trades.length > 0 ? Number(((wins / trades.length) * 100).toFixed(1)) : 0;
    const totalGainUsd = trades.filter((t) => t.pnlUsd > 0).reduce((a, b) => a + b.pnlUsd, 0);
    const totalLossUsd = Math.abs(trades.filter((t) => t.pnlUsd < 0).reduce((a, b) => a + b.pnlUsd, 0));
    const netProfitUsd = Number((totalGainUsd - totalLossUsd).toFixed(2));
    const profitFactor = totalLossUsd > 0 ? Number((totalGainUsd / totalLossUsd).toFixed(2)) : 99.99;

    return {
      symbol,
      days,
      totalTrades: trades.length,
      wins,
      losses,
      winRatePct,
      netProfitUsd,
      totalGainUsd: Number(totalGainUsd.toFixed(2)),
      totalLossUsd: Number(totalLossUsd.toFixed(2)),
      profitFactor,
      trades,
    };
  }

  // ── UTILIDADES DE RETESTEO, DESCARGA Y CÁLCULO ───────────────────────────

  /**
   * Algoritmo de agrupación de niveles de spikes para identificar ZONAS DE RETESTEO.
   */
  findRetestZones(
    candles: any[],
    currentPrice: number,
    minDrop: number = 12.0,
    tolerancePts: number = 4.5,
    isBoom: boolean = false,
  ): RetestZone[] {
    const spikes: { epoch: number; high: number; low: number; drop: number }[] = [];
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const drop = isBoom ? (c.high - c.open) : (c.open - c.low);
      if (drop >= minDrop) {
        spikes.push({
          epoch: Number(c.epoch),
          high: Number(c.open),
          low: Number(c.low),
          drop: Number(drop.toFixed(2)),
        });
      }
    }

    const clusters: {
      level: number;
      minPrice: number;
      maxPrice: number;
      spikes: { epoch: number; high: number; low: number; drop: number }[];
    }[] = [];

    for (const s of spikes) {
      let matched = false;
      for (const cl of clusters) {
        if (Math.abs(s.high - cl.level) <= tolerancePts) {
          cl.spikes.push(s);
          cl.level = cl.spikes.reduce((a, b) => a + b.high, 0) / cl.spikes.length;
          cl.minPrice = Math.min(cl.minPrice, s.high);
          cl.maxPrice = Math.max(cl.maxPrice, s.high);
          matched = true;
          break;
        }
      }
      if (!matched) {
        clusters.push({
          level: s.high,
          minPrice: s.high,
          maxPrice: s.high,
          spikes: [s],
        });
      }
    }

    return clusters
      .filter((cl) => cl.spikes.length >= 2)
      .map((cl, idx) => {
        const avgDrop = Number((cl.spikes.reduce((a, b) => a + b.drop, 0) / cl.spikes.length).toFixed(1));
        const maxDrop = Math.max(...cl.spikes.map((s) => s.drop));
        const lastSpike = cl.spikes.reduce((prev, curr) => (curr.epoch > prev.epoch ? curr : prev), cl.spikes[0]);
        const distToCurrentPts = Number((cl.level - currentPrice).toFixed(2));
        const distToCurrentPct = Number(((Math.abs(distToCurrentPts) / (currentPrice || 1)) * 100).toFixed(2));
        const isRetestingNow = Math.abs(distToCurrentPts) <= tolerancePts;

        return {
          id: `ZONE-${idx + 1}-${Math.round(cl.level)}`,
          level: Number(cl.level.toFixed(2)),
          minPrice: Number(cl.minPrice.toFixed(2)),
          maxPrice: Number(cl.maxPrice.toFixed(2)),
          spikeCount: cl.spikes.length,
          avgDrop,
          maxDrop,
          lastReactionEpoch: lastSpike.epoch,
          lastReactionDateStr: new Date(lastSpike.epoch * 1000).toLocaleString('es-MX', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          distToCurrentPts,
          distToCurrentPct,
          isRetestingNow,
        };
      })
      .sort((a, b) => Math.abs(a.distToCurrentPts) - Math.abs(b.distToCurrentPts));
  }

  private async fetchRecentCandles(symbol: string, granularity: number, count: number): Promise<any[]> {
    const dbCandles = await this.candlesService.findLatest(symbol, granularity, count);
    if (dbCandles && dbCandles.length >= count * 0.8) {
      return [...dbCandles].sort((a, b) => a.epoch - b.epoch);
    }
    const res: any = await this.derivWs.getCandlesHistory(symbol, granularity, count);
    return (res?.candles || []).sort((a: any, b: any) => a.epoch - b.epoch);
  }

  private async fetchHistoricalCandlesPaginated(symbol: string, granularity: number, targetCount: number): Promise<any[]> {
    const map = new Map<number, any>();
    let remaining = targetCount;
    let endEpoch: any = 'latest';

    while (remaining > 0) {
      const batchSize = Math.min(5000, remaining);
      const res: any = await this.derivWs.getCandlesHistory(symbol, granularity, batchSize, endEpoch);
      const list = res?.candles || [];
      if (list.length === 0) break;

      for (const c of list) {
        map.set(Number(c.epoch), c);
      }

      const earliest = Number(list[0].epoch);
      if (earliest === endEpoch || list.length < 500) break;
      endEpoch = earliest;
      remaining -= list.length;
    }

    return Array.from(map.values()).sort((a, b) => a.epoch - b.epoch);
  }

  private calcEma(values: number[], period: number): number[] {
    if (!values || values.length === 0) return [];
    const k = 2 / (period + 1);
    const emaArr = [values[0]];
    for (let i = 1; i < values.length; i++) {
      emaArr.push(values[i] * k + emaArr[i - 1] * (1 - k));
    }
    return emaArr;
  }
}
