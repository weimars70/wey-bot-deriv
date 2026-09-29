import { Injectable, Logger } from '@nestjs/common';
import { CandlesService } from '../candles/candles.service';

export const CRASH_SYMBOLS = [
  { symbol: 'CRASH300N', name: 'Crash 300' },
  { symbol: 'CRASH500',  name: 'Crash 500' },
  { symbol: 'CRASH600',  name: 'Crash 600' },
  { symbol: 'CRASH900',  name: 'Crash 900' },
  { symbol: 'CRASH1000', name: 'Crash 1000' },
];

export const BOOM_SYMBOLS = [
  { symbol: 'BOOM300N', name: 'Boom 300' },
  { symbol: 'BOOM500',  name: 'Boom 500' },
  { symbol: 'BOOM600',  name: 'Boom 600' },
  { symbol: 'BOOM900',  name: 'Boom 900' },
  { symbol: 'BOOM1000', name: 'Boom 1000' },
];

export const CRASH_BOOM_IA_SYMBOLS = [...CRASH_SYMBOLS, ...BOOM_SYMBOLS];

export interface VPatternCandidate {
  epoch: number;
  timeStr: string;
  priceLow: number;
  priceHigh: number;
  vLinePrice: number;
  distToBlue: number;
}

export interface OrderBlockPoint {
  epoch: number;
  timeStr: string;
  timeframe: string;
  high: number;        // Techo del OB (En Crash: SL / Invalidación; En Boom: Inicio de zona de compra)
  mid50: number;       // 50% Mean Threshold (Entrada institucional óptima: SELL en Crash / BUY en Boom)
  low: number;         // Base del OB (En Crash: Inicio de zona; En Boom: SL / Invalidación)
  open: number;
  close: number;
  drop: number;        // Magnitud del spike posterior (caída en Crash / subida en Boom)
  status: 'FRESCO' | 'EN_ZONA' | 'MITIGADO' | 'INVALIDADO';
  statusLabel: string;
  statusSeverity: 'success' | 'warning' | 'negative' | 'info';
  distToPrice: number; // Distancia en puntos al 50% del OB
  inZone: boolean;     // true si currentPrice está entre low y high
}

export interface CrashIaEvaluation {
  symbol: string;
  mercado: string;
  marketType: 'CRASH' | 'BOOM';
  operationType: 'SELL' | 'BUY';
  currentPrice: number;
  h1LinePrice: number;
  vLinePrice: number;
  m5CandleHeight: number;
  boxFloor: number;
  boxCeiling: number;
  entryLevel50: number;
  stopLossPrice: number;
  h1StructuralPrice: number | null;
  status: 'EN_ZONA_50' | 'EN_BASE_CAJA' | 'EN_MARGEN_SL' | 'SL_SUPERADO' | 'BAJO_ZONA' | 'SOBRE_ZONA' | 'EN_RETESTEO';
  statusLabel: string;
  statusSeverity: 'success' | 'warning' | 'negative' | 'info';
  canSell: boolean;
  canBuy: boolean;
  filters: {
    trendM15: 'BAJISTA' | 'ALCISTA';
    trendOk: boolean;
    ema50_M15: number;
    rsi_M5: number;
    rsiOk: boolean;
    consecutiveGreenM1: number;
    consecutiveRedM1: number;
    minGreenRequired: number;
    greenOk: boolean; // Indica si pasó el filtro de velas de enfriamiento M1 (verdes en Crash, rojas en Boom)
    velaAmigaOk: boolean;
    velaAmigaMsg: string;
  };
  vCandidate: VPatternCandidate | null;
  activeOrderBlock: OrderBlockPoint | null;
  recentOrderBlocks: OrderBlockPoint[];
  retestZone?: {
    isInRetest: boolean;
    isReadyForEntry: boolean;
    retestCeiling: number;
    retestFloor: number;
    retestRange: number;
    reason: string;
  };
  m5Viability: {
    isViable: boolean;
    reason: string;
    targetReactionPrice: number;
    distToReaction: number;
    reactionType: 'ORDER_BLOCK_M5' | 'SOPORTE_ESTRUCTURAL_M5' | 'RESISTENCIA_ESTRUCTURAL_M5' | 'RETROCESO_50_M5';
  };
  chartCandles: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
  }[];
  timeframeSeconds: number;
}

@Injectable()
export class CrashIaStrategyService {
  private readonly logger = new Logger(CrashIaStrategyService.name);

  constructor(private readonly candlesService: CandlesService) {}

  private hasDoubleWickBodyPattern(candle: any): boolean {
    if (!candle || candle.body <= 0) return false;
    const minWick = candle.body * 0.25;
    const maxWick = candle.body * 2.2;
    return candle.upperWick >= minWick &&
      candle.lowerWick >= minWick &&
      candle.upperWick <= maxWick &&
      candle.lowerWick <= maxWick;
  }

  /**
   * Evalúa la estrategia completa para un símbolo (Crash o Boom) con lógica inversa institucional.
   */
  async evaluateSymbol(symbol: string, timeframeMinutes = 5): Promise<CrashIaEvaluation> {
    const sym = symbol.toUpperCase();
    const isBoom = sym.startsWith('BOOM');
    const marketType: 'CRASH' | 'BOOM' = isBoom ? 'BOOM' : 'CRASH';
    const operationType: 'SELL' | 'BUY' = isBoom ? 'BUY' : 'SELL';

    const allDefs = [...CRASH_SYMBOLS, ...BOOM_SYMBOLS];
    const mercado = allDefs.find((s) => s.symbol === sym)?.name || sym;

    // 1. Obtener velas H1 (3600), M5 (300), M15 (900) y M1 (60)
    const m5HistoryCount = 288; // ~24 horas de M5
    const m1HistoryCount = 500; // cubre los OB M5 buscados hasta ~6h40 atras
    const [h1Raw, m5Raw, m15Raw, m1Raw] = await Promise.all([
      this.candlesService.findLatest(sym, 3600, 100),
      this.candlesService.findLatest(sym, 300, m5HistoryCount), // ~24 horas de M5
      this.candlesService.findLatest(sym, 900, 100),
      this.candlesService.findLatest(sym, 60, m1HistoryCount),  // ultimas ~8h20 de M1
    ]);

    const h1Candles = [...h1Raw].sort((a, b) => Number(a.epoch) - Number(b.epoch));
    const m5Candles = [...m5Raw].sort((a, b) => Number(a.epoch) - Number(b.epoch));
    const m15Candles = [...m15Raw].sort((a, b) => Number(a.epoch) - Number(b.epoch));
    const m1Candles = [...m1Raw].sort((a, b) => Number(a.epoch) - Number(b.epoch));

    // Precio actual
    const currentPrice = m1Candles.length > 0
      ? Number(m1Candles[m1Candles.length - 1].close)
      : m5Candles.length > 0
      ? Number(m5Candles[m5Candles.length - 1].close)
      : 0;

    // 2. Línea H1 (Cierre última vela H1 completada)
    const completedH1 = h1Candles.length > 1
      ? h1Candles[h1Candles.length - 2]
      : h1Candles[0] || null;
    const h1LinePrice = completedH1 ? Number(completedH1.close) : currentPrice;

    // 3. Patrón V / Lambda en M5
    // En Crash: V normal (suelo en spike rojo previo sobre línea H1).
    // En Boom: Lambda invertida (techo en spike verde previo bajo línea H1).
    const vCandidate = isBoom
      ? this.findVPatternM5Boom(m5Candles, h1LinePrice)
      : this.findVPatternM5Crash(m5Candles, h1LinePrice);

    const vLinePrice = vCandidate ? vCandidate.vLinePrice : h1LinePrice;

    // 4. Altura de Vela M5 (mediana de velas M5 de movimiento continuo)
    const m5CandleHeight = this.calculateM5CandleHeight(m5Candles, sym, isBoom);

    // 5. Caja en Tiempo Real (3 velas M5)
    let boxFloor: number;
    let boxCeiling: number;
    let entryLevel50: number;
    let stopLossPrice: number;

    const minSlBuffer = this.getMinSlPoints(sym);

    if (!isBoom) {
      // ── CRASH: Caja proyectada hacia ARRIBA (el precio sube hasta la zona de venta)
      boxFloor = vLinePrice;
      boxCeiling = vLinePrice + (3 * m5CandleHeight);
      entryLevel50 = vLinePrice + (0.5 * 3 * m5CandleHeight); // 50% superior / resistencia
      // Stop Loss con suficiente margen estructural y holgura adecuada (mínimo amplio para 100 y 200)
      const rawSl = boxCeiling + (2.0 * m5CandleHeight);
      stopLossPrice = Math.max(rawSl, currentPrice + minSlBuffer, entryLevel50 + minSlBuffer);
    } else {
      // ── BOOM: Caja proyectada hacia ABAJO (el precio retrocede cayendo hacia el soporte de compra)
      boxCeiling = vLinePrice;
      boxFloor = vLinePrice - (3 * m5CandleHeight);
      entryLevel50 = vLinePrice - (0.5 * 3 * m5CandleHeight); // 50% inferior / descuento institucional
      // Stop Loss con suficiente margen estructural y holgura adecuada (mínimo amplio para 100 y 200)
      const rawSl = boxFloor - (2.0 * m5CandleHeight);
      stopLossPrice = Math.min(rawSl, currentPrice - minSlBuffer, entryLevel50 - minSlBuffer);
    }

    // 6. Nivel Estructural H1 (Fractal mayor: resistencia en Crash / soporte en Boom)
    const h1StructuralPrice = this.findH1StructuralLevel(h1Candles, isBoom);

    // 7. Filtro 1: Tendencia Macro (EMA 50 en M15)
    const ema50_M15 = this.calculateEMA(m15Candles.map((c) => Number(c.close)), 50);
    const trendM15: 'BAJISTA' | 'ALCISTA' = currentPrice <= ema50_M15 ? 'BAJISTA' : 'ALCISTA';
    // En Crash: precio <= EMA50 (Bajista); En Boom: precio >= EMA50 (Alcista)
    const trendOk = isBoom ? currentPrice >= ema50_M15 : currentPrice <= ema50_M15;

    // 8. Filtro 2: RSI 14 en M5
    // En Crash: sobrecompra / zona alta (RSI >= 65.0)
    // En Boom: sobreventa / zona de descuento (RSI <= 35.0)
    const rsi_M5 = this.calculateRSI(m5Candles.map((c) => Number(c.close)), 14);
    const rsiOk = isBoom ? rsi_M5 <= 35.0 : rsi_M5 >= 65.0;

    // 9. Filtro 3: Velas M1 de enfriamiento tras spike
    // En Crash: mínimo 3 velas verdes consecutivas hacia arriba tras el spike
    // En Boom: mínimo 3 velas rojas consecutivas hacia abajo tras el spike
    const consecutiveGreenM1 = this.getConsecutiveGreenM1(m1Candles);
    const consecutiveRedM1 = this.getConsecutiveRedM1(m1Candles);
    const minGreenRequired = 3;
    const greenOk = isBoom
      ? consecutiveRedM1 >= minGreenRequired
      : consecutiveGreenM1 >= minGreenRequired;

    // 10. Filtro 4: Vela Amiga H1
    const { velaAmigaOk, velaAmigaMsg } = this.checkVelaAmigaH1(h1Candles, isBoom);

    // 11. Estado del Precio respecto a la Caja
    let status: CrashIaEvaluation['status'] = 'BAJO_ZONA';
    let statusLabel = 'Fuera de zona';
    let statusSeverity: CrashIaEvaluation['statusSeverity'] = 'info';

    if (!isBoom) {
      // ── Evaluación de estado para CRASH (Venta)
      if (currentPrice > stopLossPrice) {
        status = 'SL_SUPERADO';
        statusLabel = 'Stop Loss Superado (Fuera)';
        statusSeverity = 'negative';
      } else if (currentPrice > boxCeiling) {
        status = 'EN_MARGEN_SL';
        statusLabel = 'En margen de tolerancia (+1v M5)';
        statusSeverity = 'warning';
      } else if (currentPrice >= entryLevel50) {
        status = 'EN_ZONA_50';
        statusLabel = '🎯 En Zona de Entrada (50% Superior / SELL)';
        statusSeverity = 'success';
      } else if (currentPrice >= boxFloor) {
        status = 'EN_BASE_CAJA';
        statusLabel = 'En base de caja (esperando subida al 50%)';
        statusSeverity = 'warning';
      } else {
        status = 'BAJO_ZONA';
        statusLabel = 'Por debajo de la caja V';
        statusSeverity = 'info';
      }
    } else {
      // ── Evaluación de estado para BOOM (Compra)
      if (currentPrice < stopLossPrice) {
        status = 'SL_SUPERADO';
        statusLabel = 'Stop Loss Superado (Fuera)';
        statusSeverity = 'negative';
      } else if (currentPrice < boxFloor) {
        status = 'EN_MARGEN_SL';
        statusLabel = 'En margen de tolerancia (-1v M5)';
        statusSeverity = 'warning';
      } else if (currentPrice <= entryLevel50) {
        status = 'EN_ZONA_50';
        statusLabel = '🎯 En Zona de Entrada (50% Inferior / BUY)';
        statusSeverity = 'success';
      } else if (currentPrice <= boxCeiling) {
        status = 'EN_BASE_CAJA';
        statusLabel = 'En techo de caja (esperando retroceso al 50%)';
        statusSeverity = 'warning';
      } else {
        status = 'SOBRE_ZONA';
        statusLabel = 'Por encima de la caja (esperando retroceso)';
        statusSeverity = 'info';
      }
    }

    // 12. Detección y ubicación de Puntos Order Block (OB) en temporalidad M5
    const { active: activeOrderBlock, list: recentOrderBlocks } = this.findOrderBlocks(
      m5Candles,
      currentPrice,
      sym,
      isBoom,
    );

    // 13. Validación Rigurosa de Viabilidad en Temporalidad M5
    // "viéndolo en temporalidad de m5 puede reaccionar pero más bajo, la entrada debió ser casi por donde quedó el SL"
    const m5Viability = this.checkM5ReactionViability(
      m5Candles,
      currentPrice,
      isBoom,
      activeOrderBlock,
      recentOrderBlocks,
      boxFloor,
      boxCeiling,
      entryLevel50,
    );

    // 13.1 Detección de Zona de Retesteo / Consolidación Lateral en M5
    // En Crash 500 y otros índices, cuando el precio oscila en una banda horizontal estrecha,
    // está en retesteo acumulando liquidez. No se debe entrar en el medio de la consolidación.
    const retestInfo = this.checkRetestConsolidationZone(
      m5Candles,
      currentPrice,
      m5CandleHeight,
      isBoom,
      sym,
    );

    if (retestInfo.isInRetest && !retestInfo.isReadyForEntry) {
      if (status === 'EN_ZONA_50' || status === 'EN_BASE_CAJA') {
        status = 'EN_RETESTEO';
        statusLabel = isBoom
          ? '⏳ En Zona de Retesteo (Esperando piso o quiebre)'
          : '⏳ En Zona de Retesteo (Esperando techo o quiebre)';
        statusSeverity = 'warning';
      }
      m5Viability.isViable = false;
      m5Viability.reason = retestInfo.reason;
    } else if (retestInfo.isInRetest && retestInfo.isReadyForEntry) {
      m5Viability.reason = retestInfo.reason;
      m5Viability.isViable = true;
    }

    const repeatedReaction = this.detectRepeatedM5Reaction(
      m5Candles,
      sym,
      isBoom,
      currentPrice,
      boxFloor,
      boxCeiling,
      entryLevel50,
      retestInfo.isInRetest && !retestInfo.isReadyForEntry,
    );

    const canSell =
      !isBoom &&
      status !== 'EN_RETESTEO' &&
      (
        (status === 'EN_ZONA_50' && trendOk && greenOk && m5Viability.isViable) ||
        (repeatedReaction.isDetected && trendOk && greenOk && repeatedReaction.zoneDistance <= Math.max(10, this.getDefaultM5Height(sym) * 2))
      );
    const canBuy =
      isBoom &&
      status !== 'EN_RETESTEO' &&
      (
        (status === 'EN_ZONA_50' && trendOk && greenOk && m5Viability.isViable) ||
        (repeatedReaction.isDetected && trendOk && greenOk && repeatedReaction.zoneDistance <= Math.max(10, this.getDefaultM5Height(sym) * 2))
      );

    if (repeatedReaction.isDetected && !retestInfo.isInRetest && (!m5Viability.isViable || m5Viability.reason.includes('no alcanza'))) {
      m5Viability.reason = repeatedReaction.reason;
      m5Viability.isViable = true;
    }

    // 14. Velas a retornar para el gráfico según temporalidad solicitada
    const timeframeSeconds = (timeframeMinutes || 5) * 60;
    let selectedCandles = m5Candles;
    if (timeframeSeconds === 60) selectedCandles = m1Candles;
    else if (timeframeSeconds === 900) selectedCandles = m15Candles;
    else if (timeframeSeconds === 3600) selectedCandles = h1Candles;

    const chartCandles = selectedCandles.map((c) => ({
      time: Number(c.epoch),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }));

    return {
      symbol: sym,
      mercado,
      marketType,
      operationType,
      currentPrice: parseFloat(currentPrice.toFixed(3)),
      h1LinePrice: parseFloat(h1LinePrice.toFixed(3)),
      vLinePrice: parseFloat(vLinePrice.toFixed(3)),
      m5CandleHeight: parseFloat(m5CandleHeight.toFixed(3)),
      boxFloor: parseFloat(boxFloor.toFixed(3)),
      boxCeiling: parseFloat(boxCeiling.toFixed(3)),
      entryLevel50: parseFloat(entryLevel50.toFixed(3)),
      stopLossPrice: parseFloat(stopLossPrice.toFixed(3)),
      h1StructuralPrice: h1StructuralPrice ? parseFloat(h1StructuralPrice.toFixed(3)) : null,
      status,
      statusLabel,
      statusSeverity,
      canSell,
      canBuy,
      filters: {
        trendM15,
        trendOk,
        ema50_M15: parseFloat(ema50_M15.toFixed(3)),
        rsi_M5: parseFloat(rsi_M5.toFixed(2)),
        rsiOk,
        consecutiveGreenM1,
        consecutiveRedM1,
        minGreenRequired,
        greenOk,
        velaAmigaOk,
        velaAmigaMsg,
      },
      vCandidate,
      activeOrderBlock,
      recentOrderBlocks,
      m5Viability,
      chartCandles,
      timeframeSeconds,
      retestZone: {
        isInRetest: retestInfo.isInRetest,
        isReadyForEntry: retestInfo.isReadyForEntry,
        retestCeiling: parseFloat(retestInfo.retestCeiling.toFixed(3)),
        retestFloor: parseFloat(retestInfo.retestFloor.toFixed(3)),
        retestRange: parseFloat(retestInfo.retestRange.toFixed(3)),
        reason: retestInfo.reason,
      },
    };
  }

  /**
   * Resumen rápido de todos los índices Crash y Boom.
   */
  async getSummaryAll(): Promise<Omit<CrashIaEvaluation, 'chartCandles'>[]> {
    const list = await Promise.all(
      CRASH_BOOM_IA_SYMBOLS.map((s) => this.evaluateSymbol(s.symbol, 5)),
    );
    return list.map(({ chartCandles, ...rest }) => rest);
  }

  async evaluateDoubleWickMecha(symbol: string, timeframeSeconds = 300): Promise<{
    symbol: string;
    mercado: string;
    marketType: 'CRASH' | 'BOOM';
    direction: 'SELL' | 'BUY';
    currentPrice: number;
    entryPrice: number;
    stopLossPrice: number;
    previousCandle: {
      epoch: number;
      timeStr: string;
      open: number;
      high: number;
      low: number;
      close: number;
      body: number;
      upperWick: number;
      lowerWick: number;
      isBullish: boolean;
      isBearish: boolean;
    };
    currentCandle: {
      epoch: number;
      timeStr: string;
      open: number;
      high: number;
      low: number;
      close: number;
      body: number;
      upperWick: number;
      lowerWick: number;
      isBullish: boolean;
      isBearish: boolean;
    };
    reason: string;
    isValid: boolean;
    timeframe: 'M5' | 'H1';
    autoTrade: boolean;
    patternEpoch: number;
  } | null> {
    const sym = (symbol || '').toUpperCase();
    const isBoom = sym.startsWith('BOOM');
    const marketType: 'CRASH' | 'BOOM' = isBoom ? 'BOOM' : 'CRASH';
    const direction: 'SELL' | 'BUY' = isBoom ? 'BUY' : 'SELL';
    const allDefs = [...CRASH_SYMBOLS, ...BOOM_SYMBOLS];
    const mercado = allDefs.find((s) => s.symbol === sym)?.name || sym;

    const granularity = timeframeSeconds === 3600 ? 3600 : 300;
    const timeframe: 'M5' | 'H1' = granularity === 3600 ? 'H1' : 'M5';
    const currentBucket = Math.floor(Date.now() / 1000 / granularity) * granularity;
    const raw = await this.candlesService.findLatest(sym, granularity, 40);
    const candles = [...raw]
      .filter((c) => Number(c.epoch) < currentBucket)
      .sort((a, b) => Number(a.epoch) - Number(b.epoch));
    if (candles.length < 2) return null;

    const normalize = (c: any) => {
      const open = Number(c.open);
      const high = Number(c.high);
      const low = Number(c.low);
      const close = Number(c.close);
      const body = Math.abs(close - open);
      const upperWick = Math.max(0, high - Math.max(open, close));
      const lowerWick = Math.max(0, Math.min(open, close) - low);
      return {
        epoch: Number(c.epoch),
        timeStr: new Date(Number(c.epoch) * 1000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        open,
        high,
        low,
        close,
        body,
        upperWick,
        lowerWick,
        isBullish: close >= open,
        isBearish: close <= open,
      };
    };

    const prevCandle = normalize(candles[candles.length - 2]);
    const currentCandle = normalize(candles[candles.length - 1]);

    const prevHasLongWicks = this.hasDoubleWickBodyPattern(prevCandle);
    const currentHasLongWicks = this.hasDoubleWickBodyPattern(currentCandle);

    const hasDoubleMecha = (a: any, b: any) =>
      a && b &&
      prevHasLongWicks &&
      currentHasLongWicks;

    const bodyMomentumOk =
      Math.abs(currentCandle.close - prevCandle.close) >= Math.max(0.8, Math.min(prevCandle.body, currentCandle.body) * 0.5) ||
      currentCandle.body >= prevCandle.body * 0.35;

    const boomValid =
      isBoom &&
      hasDoubleMecha(prevCandle, currentCandle) &&
      prevCandle.isBullish &&
      currentCandle.isBullish &&
      currentCandle.close > prevCandle.close &&
      currentCandle.high > prevCandle.high &&
      currentCandle.low > prevCandle.low &&
      bodyMomentumOk;

    const crashValid =
      !isBoom &&
      hasDoubleMecha(prevCandle, currentCandle) &&
      prevCandle.isBearish &&
      currentCandle.isBearish &&
      currentCandle.close < prevCandle.close &&
      currentCandle.high < prevCandle.high &&
      currentCandle.low < prevCandle.low &&
      bodyMomentumOk;

    const maxRange = Math.max(
      currentCandle.high - currentCandle.low,
      prevCandle.high - prevCandle.low,
      3.0,
    );
    const minBuffer = this.getMinSlPoints(sym);
    const entryPrice = Number(currentCandle.close);
    const stopLossPrice = isBoom
      ? Number(
          (
            Math.min(currentCandle.low, prevCandle.low) -
            Math.max(maxRange * 1.5, 6.0) -
            minBuffer
          ).toFixed(3),
        )
      : Number(
          (
            Math.max(currentCandle.high, prevCandle.high) +
            Math.max(maxRange * 1.5, 6.0) +
            minBuffer
          ).toFixed(3),
        );

    let reason = isBoom
      ? `Dos velas ${timeframe} alcistas con mechas largas; la segunda está completamente más alta que la primera: señal BUY.`
      : `Dos velas ${timeframe} bajistas con mechas largas; la segunda está completamente más baja que la primera: señal SELL.`;

    if (!boomValid && !crashValid) {
      if (!prevHasLongWicks || !currentHasLongWicks) {
        reason = `Cada una de las dos velas ${timeframe} debe tener mecha superior e inferior visibles, con un ancho compatible con el cuerpo.`;
      } else {
        reason = isBoom
          ? 'Deben ser dos velas alcistas y la segunda debe tener máximo, mínimo y cierre por encima de la primera.'
          : 'Deben ser dos velas bajistas y la segunda debe tener máximo, mínimo y cierre por debajo de la primera.';
      }

      return {
        symbol: sym,
        mercado,
        marketType,
        direction,
        currentPrice: Number(currentCandle.close),
        entryPrice,
        stopLossPrice,
        previousCandle: prevCandle,
        currentCandle,
        reason,
        isValid: false,
        timeframe,
        autoTrade: timeframe === 'M5',
        patternEpoch: currentCandle.epoch,
      };
    }

    return {
      symbol: sym,
      mercado,
      marketType,
      direction,
      currentPrice: Number(currentCandle.close),
      entryPrice,
      stopLossPrice,
      previousCandle: prevCandle,
      currentCandle,
      reason,
      isValid: true,
      timeframe,
      autoTrade: timeframe === 'M5',
      patternEpoch: currentCandle.epoch,
    };
  }

  async getDoubleWickMechaSummary(): Promise<Array<{
    symbol: string;
    mercado: string;
    marketType: 'CRASH' | 'BOOM';
    direction: 'SELL' | 'BUY';
    currentPrice: number;
    entryPrice: number;
    stopLossPrice: number;
    reason: string;
    isValid: boolean;
    timeframe: 'M5' | 'H1';
    autoTrade: boolean;
    patternEpoch: number;
  }>> {
    const results = await Promise.all(
      CRASH_BOOM_IA_SYMBOLS.map((s) => this.evaluateDoubleWickMecha(s.symbol)),
    );
    return results
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => ({
        symbol: item.symbol,
        mercado: item.mercado,
        marketType: item.marketType,
        direction: item.direction,
        currentPrice: item.currentPrice,
        entryPrice: item.entryPrice,
        stopLossPrice: item.stopLossPrice,
        reason: item.reason,
        isValid: item.isValid,
        timeframe: item.timeframe,
        autoTrade: item.autoTrade,
        patternEpoch: item.patternEpoch,
      }));
  }

  async getDoubleWickH1Summary() {
    const results = await Promise.all(
      CRASH_BOOM_IA_SYMBOLS.map((s) => this.evaluateDoubleWickMecha(s.symbol, 3600)),
    );
    return results
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => ({
        symbol: item.symbol,
        mercado: item.mercado,
        marketType: item.marketType,
        direction: item.direction,
        reason: item.reason,
        isValid: item.isValid,
        timeframe: item.timeframe,
        autoTrade: false,
        patternEpoch: item.patternEpoch,
      }));
  }

  /**
   * Escanea las últimas `days` días de velas M5 almacenadas para `symbol`,
   * detecta cada ocurrencia del patrón de dos velas (doble mecha) y verifica
   * si en las siguientes 6 velas M5 (~30 min) apareció un spike.
   *
   * Retorna: lista de ocurrencias + resumen de efectividad.
   */
  async getDoubleWickHistory(symbol: string, days: number = 7): Promise<{
    symbol: string;
    mercado: string;
    totalPatterns: number;
    withSpike: number;
    withoutSpike: number;
    spikeRatePct: number;
    rows: Array<{
      patternTime: string;
      epoch: number;
      prevClose: number;
      currClose: number;
      direction: 'BUY' | 'SELL';
      entryPrice: number;
      stopLossPrice: number;
      spikeFollowed: boolean;
      spikePoints: number;
      spikeTime: string;
      result: 'SPIKE' | 'NO SPIKE';
    }>;
  }> {
    const sym = (symbol || '').toUpperCase();
    const isBoom = sym.startsWith('BOOM');
    const allDefs = [...CRASH_SYMBOLS, ...BOOM_SYMBOLS];
    const mercado = allDefs.find((s) => s.symbol === sym)?.name || sym;

    const candlesNeeded = Math.min(days * 24 * 12 + 50, 2000);
    const raw = await this.candlesService.findLatest(sym, 300, candlesNeeded);
    const candles = [...raw].sort((a, b) => Number(a.epoch) - Number(b.epoch));

    if (candles.length < 10) {
      return { symbol: sym, mercado, totalPatterns: 0, withSpike: 0, withoutSpike: 0, spikeRatePct: 0, rows: [] };
    }

    const normalize = (c: any) => {
      const open = Number(c.open);
      const high = Number(c.high);
      const low = Number(c.low);
      const close = Number(c.close);
      const body = Math.abs(close - open);
      const upperWick = Math.max(0, high - Math.max(open, close));
      const lowerWick = Math.max(0, Math.min(open, close) - low);
      return { epoch: Number(c.epoch), open, high, low, close, body, upperWick, lowerWick,
               isBullish: close >= open, isBearish: close <= open };
    };

    const hasLongWicksAroundBody = (c: ReturnType<typeof normalize>) => this.hasDoubleWickBodyPattern(c);

    const spikeThreshold = this.getMinSlPoints(sym) * 0.6;
    const minBodyPts = Math.max(this.getDefaultM5Height(sym) * 0.35, 0.8);

    const rows: Array<{
      patternTime: string; epoch: number; prevClose: number; currClose: number;
      direction: 'BUY' | 'SELL'; entryPrice: number; stopLossPrice: number;
      spikeFollowed: boolean; spikePoints: number; spikeTime: string;
      result: 'SPIKE' | 'NO SPIKE';
    }> = [];

    const cutoffEpoch = Math.floor(Date.now() / 1000) - days * 86400;
    let lastPatternIdx = -10;

    for (let i = 1; i < candles.length - 6; i++) {
      if (Number(candles[i].epoch) < cutoffEpoch) continue;
      if (i - lastPatternIdx < 3) continue;

      const prev = normalize(candles[i - 1]);
      const curr = normalize(candles[i]);

      if (prev.body < minBodyPts || curr.body < minBodyPts) continue;
      if (!hasLongWicksAroundBody(prev) || !hasLongWicksAroundBody(curr)) continue;

      const boomValid = isBoom &&
        prev.isBullish && curr.isBullish &&
        curr.close > prev.close && curr.high > prev.high && curr.low > prev.low &&
        curr.body >= prev.body * 0.4;

      const crashValid = !isBoom &&
        prev.isBearish && curr.isBearish &&
        curr.close < prev.close && curr.high < prev.high && curr.low < prev.low &&
        curr.body >= prev.body * 0.4;

      if (!boomValid && !crashValid) continue;

      const maxRange = Math.max(curr.high - curr.low, prev.high - prev.low, 3.0);
      const minBuffer = this.getMinSlPoints(sym);
      const entryPrice = curr.close;
      const stopLossPrice = isBoom
        ? Number((Math.min(curr.low, prev.low) - Math.max(maxRange * 1.5, 6.0) - minBuffer).toFixed(3))
        : Number((Math.max(curr.high, prev.high) + Math.max(maxRange * 1.5, 6.0) + minBuffer).toFixed(3));

      let spikeFollowed = false;
      let spikePoints = 0;
      let spikeEpoch = 0;

      for (let j = i + 1; j <= Math.min(i + 6, candles.length - 1); j++) {
        const fc = normalize(candles[j]);
        const spikeMagnitude = isBoom ? (fc.high - fc.open) : (fc.open - fc.low);
        if (spikeMagnitude >= spikeThreshold) {
          spikeFollowed = true;
          spikePoints = Number(spikeMagnitude.toFixed(2));
          spikeEpoch = fc.epoch;
          break;
        }
      }

      const patternDate = new Date(curr.epoch * 1000);
      const pad = (n: number) => n.toString().padStart(2, '0');
      const patternTime = `${pad(patternDate.getDate())}/${pad(patternDate.getMonth() + 1)} ${pad(patternDate.getHours())}:${pad(patternDate.getMinutes())}`;
      const spikeTimeStr = spikeEpoch
        ? (() => { const d = new Date(spikeEpoch * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; })()
        : '';

      rows.push({
        patternTime, epoch: curr.epoch,
        prevClose: Number(prev.close.toFixed(3)),
        currClose: Number(curr.close.toFixed(3)),
        direction: isBoom ? 'BUY' : 'SELL',
        entryPrice: Number(entryPrice.toFixed(3)),
        stopLossPrice,
        spikeFollowed, spikePoints, spikeTime: spikeTimeStr,
        result: spikeFollowed ? 'SPIKE' : 'NO SPIKE',
      });

      lastPatternIdx = i;
    }

    rows.reverse();

    const withSpike = rows.filter((r) => r.spikeFollowed).length;
    const withoutSpike = rows.length - withSpike;
    const spikeRatePct = rows.length > 0
      ? Number(((withSpike / rows.length) * 100).toFixed(1))
      : 0;

    return { symbol: sym, mercado, totalPatterns: rows.length, withSpike, withoutSpike, spikeRatePct, rows };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FUNCIONES MATEMÁTICAS Y ALGORITMOS DE CRASH Y BOOM IA
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Evalúa rigurosamente en temporalidad M5 si el precio se encuentra en la verdadera zona de reacción.
   * "viéndolo en temporalidad de m5 puede reaccionar pero más bajo, la entrada debió ser casi por donde quedó el SL"
   */
  private checkM5ReactionViability(
    m5Candles: any[],
    currentPrice: number,
    isBoom: boolean,
    activeOB: OrderBlockPoint | null,
    recentOBs: OrderBlockPoint[],
    boxFloor: number,
    boxCeiling: number,
    entryLevel50: number,
  ): {
    isViable: boolean;
    reason: string;
    targetReactionPrice: number;
    distToReaction: number;
    reactionType: 'ORDER_BLOCK_M5' | 'SOPORTE_ESTRUCTURAL_M5' | 'RESISTENCIA_ESTRUCTURAL_M5' | 'RETROCESO_50_M5';
  } {
    // 1. Prioridad: Order Block Institucional en M5
    if (activeOB && (activeOB.status === 'EN_ZONA' || activeOB.status === 'FRESCO')) {
      if (isBoom) {
        // En BOOM: La reacción alcista ocurre en el Order Block de soporte (abajo)
        const targetReactionPrice = activeOB.mid50;
        const tolerance = Math.max((activeOB.high - activeOB.low) * 0.4, 2.0);
        const distToReaction = parseFloat((currentPrice - targetReactionPrice).toFixed(3));

        if (currentPrice <= activeOB.high + tolerance) {
          return {
            isViable: true,
            reason: `En M5 el precio está en zona óptima de Order Block (${activeOB.low} - ${activeOB.high})`,
            targetReactionPrice,
            distToReaction,
            reactionType: 'ORDER_BLOCK_M5',
          };
        } else {
          return {
            isViable: false,
            reason: `En TF M5 le falta retroceso al Order Block/Soporte (${targetReactionPrice}). Distancia restante: ${distToReaction} pts`,
            targetReactionPrice,
            distToReaction,
            reactionType: 'ORDER_BLOCK_M5',
          };
        }
      } else {
        // En CRASH: La reacción bajista ocurre en el Order Block de resistencia (arriba)
        const targetReactionPrice = activeOB.mid50;
        const tolerance = Math.max((activeOB.high - activeOB.low) * 0.4, 2.0);
        const distToReaction = parseFloat((targetReactionPrice - currentPrice).toFixed(3));

        if (currentPrice >= activeOB.low - tolerance) {
          return {
            isViable: true,
            reason: `En M5 el precio está en zona óptima de Order Block (${activeOB.low} - ${activeOB.high})`,
            targetReactionPrice,
            distToReaction,
            reactionType: 'ORDER_BLOCK_M5',
          };
        } else {
          return {
            isViable: false,
            reason: `En TF M5 le falta subida al Order Block/Resistencia (${targetReactionPrice}). Distancia restante: ${distToReaction} pts`,
            targetReactionPrice,
            distToReaction,
            reactionType: 'ORDER_BLOCK_M5',
          };
        }
      }
    }

    // 2. Si no hay OB activo, buscar el soporte/resistencia estructural de los últimos spikes M5
    if (m5Candles && m5Candles.length >= 10) {
      if (isBoom) {
        const spikeBases: number[] = [];
        for (let i = m5Candles.length - 2; i >= Math.max(0, m5Candles.length - 30); i--) {
          const c = m5Candles[i];
          const next = m5Candles[i + 1];
          if (Number(next.close) - Number(next.open) >= 4.0) {
            spikeBases.push(Number(c.low));
          }
        }

        if (spikeBases.length > 0) {
          const targetReactionPrice = parseFloat(
            (spikeBases.reduce((a, b) => a + b, 0) / spikeBases.length).toFixed(3),
          );
          const distToReaction = parseFloat((currentPrice - targetReactionPrice).toFixed(3));
          if (distToReaction <= 3.5) {
            return {
              isViable: true,
              reason: `En M5 el precio está en soporte estructural de spikes (${targetReactionPrice})`,
              targetReactionPrice,
              distToReaction,
              reactionType: 'SOPORTE_ESTRUCTURAL_M5',
            };
          } else {
            return {
              isViable: false,
              reason: `En TF M5 el precio está muy arriba (${currentPrice}); los spikes nacen cerca de ${targetReactionPrice} (faltan ${distToReaction} pts)`,
              targetReactionPrice,
              distToReaction,
              reactionType: 'SOPORTE_ESTRUCTURAL_M5',
            };
          }
        }
      } else {
        const spikeTops: number[] = [];
        for (let i = m5Candles.length - 2; i >= Math.max(0, m5Candles.length - 30); i--) {
          const c = m5Candles[i];
          const next = m5Candles[i + 1];
          if (Number(next.open) - Number(next.close) >= 4.0) {
            spikeTops.push(Number(c.high));
          }
        }

        if (spikeTops.length > 0) {
          const targetReactionPrice = parseFloat(
            (spikeTops.reduce((a, b) => a + b, 0) / spikeTops.length).toFixed(3),
          );
          const distToReaction = parseFloat((targetReactionPrice - currentPrice).toFixed(3));
          if (distToReaction <= 3.5) {
            return {
              isViable: true,
              reason: `En M5 el precio está en resistencia estructural de spikes (${targetReactionPrice})`,
              targetReactionPrice,
              distToReaction,
              reactionType: 'RESISTENCIA_ESTRUCTURAL_M5',
            };
          } else {
            return {
              isViable: false,
              reason: `En TF M5 el precio está muy abajo (${currentPrice}); las caídas nacen cerca de ${targetReactionPrice} (faltan ${distToReaction} pts)`,
              targetReactionPrice,
              distToReaction,
              reactionType: 'RESISTENCIA_ESTRUCTURAL_M5',
            };
          }
        }
      }
    }

    // 3. Fallback: 50% de retroceso
    const targetReactionPrice = entryLevel50;
    const distToReaction = parseFloat(Math.abs(currentPrice - targetReactionPrice).toFixed(3));
    const isViable = isBoom ? currentPrice <= entryLevel50 : currentPrice >= entryLevel50;
    return {
      isViable,
      reason: isViable
        ? `En M5 el precio alcanzó la zona del 50% (${targetReactionPrice})`
        : `En TF M5 aún no alcanza la zona del 50% (${targetReactionPrice})`,
      targetReactionPrice,
      distToReaction,
      reactionType: 'RETROCESO_50_M5',
    };
  }

  /**
   * Umbral mínimo de caída/spike para validar un Order Block institucional según el índice.
   */
  private getMinSpikeDropForOB(symbol: string): number {
    const up = (symbol || '').toUpperCase();
    // Check longer names first because "CRASH1000" also contains "100".
    if (up.includes('1000')) return 10.0;
    if (up.includes('100')) return 3.0;
    if (up.includes('200')) return 3.5;
    if (up.includes('300')) return 4.0;
    if (up.includes('500')) return 6.0;
    if (up.includes('600')) return 8.0;
    if (up.includes('900')) return 10.0;
    return 6.0;
  }

  /**
   * Ubica y analiza los Order Blocks (OB) en temporalidad M5:
   * - En CRASH: Bearish OB -> última vela alcista (verde) previa al spike de caída.
   * - En BOOM: Bullish OB -> última vela bajista (roja) previa al spike de subida.
   * - Calcula: OB Techo, OB Base y OB 50% (Mean Threshold).
   * - Evalúa el estado: FRESCO (Sin mitigar), EN_ZONA, MITIGADO o INVALIDADO.
   */
  private findOrderBlocks(
    m5Candles: any[],
    currentPrice: number,
    symbol: string,
    isBoom: boolean,
  ): { active: OrderBlockPoint | null; list: OrderBlockPoint[] } {
    if (!m5Candles || m5Candles.length < 6) return { active: null, list: [] };

    const minDrop = this.getMinSpikeDropForOB(symbol);
    const list: OrderBlockPoint[] = [];
    const structureLookback = 8;
    const impulseWindow = 3;
    const lastClosedIndex = m5Candles.length - 2;
    const breakBuffer = Math.max(0.001, minDrop * 0.05);

    // La ultima vela puede seguir abierta. El origen y su BOS deben confirmarse
    // solamente con velas cerradas.
    for (let i = lastClosedIndex - 1; i >= Math.max(3, m5Candles.length - 80); i--) {
      const c = m5Candles[i];
      const cOpen = Number(c.open);
      const cClose = Number(c.close);
      const cHigh = Number(c.high);
      const cLow = Number(c.low);

      // Ultima vela contraria inmediatamente antes del desplazamiento.
      const isCandidateCandle = isBoom ? cClose < cOpen : cClose > cOpen;
      if (!isCandidateCandle) continue;

      const firstImpulseCandle = m5Candles[i + 1];
      const firstImpulseOpen = Number(firstImpulseCandle.open);
      const firstImpulseClose = Number(firstImpulseCandle.close);
      const startsInExpectedDirection = isBoom
        ? firstImpulseClose > firstImpulseOpen
        : firstImpulseClose < firstImpulseOpen;
      if (!startsInExpectedDirection) continue;

      const priorCandles = m5Candles.slice(Math.max(0, i - structureLookback), i);
      if (priorCandles.length < 3) continue;

      const structureLevel = isBoom
        ? Math.max(...priorCandles.map((item) => Number(item.high)))
        : Math.min(...priorCandles.map((item) => Number(item.low)));

      let confirmationIndex = -1;
      let spikeMagnitude = 0;
      let impulseLow = Number.POSITIVE_INFINITY;
      let impulseHigh = Number.NEGATIVE_INFINITY;
      const impulseEndIndex = Math.min(lastClosedIndex, i + impulseWindow);

      // El impulso puede ocupar hasta tres velas, pero debe cerrar rompiendo el
      // swing previo. Una mecha o una vela aislada no confirman un OB.
      for (let j = i + 1; j <= impulseEndIndex; j++) {
        const impulseCandle = m5Candles[j];
        const impulseClose = Number(impulseCandle.close);
        impulseLow = Math.min(impulseLow, Number(impulseCandle.low));
        impulseHigh = Math.max(impulseHigh, Number(impulseCandle.high));

        const directionalMove = isBoom
          ? impulseHigh - cLow
          : cHigh - impulseLow;
        const netCloseMove = isBoom
          ? impulseClose - cClose
          : cClose - impulseClose;
        const brokeStructure = isBoom
          ? impulseClose > structureLevel + breakBuffer
          : impulseClose < structureLevel - breakBuffer;

        if (
          directionalMove >= minDrop &&
          netCloseMove >= minDrop * 0.5 &&
          brokeStructure
        ) {
          confirmationIndex = j;
          spikeMagnitude = directionalMove;
          break;
        }
      }

      if (confirmationIndex === -1) continue;

      const obHigh = parseFloat(cHigh.toFixed(3));
      const obLow = parseFloat(cLow.toFixed(3));
      const obMid50 = parseFloat(((obHigh + obLow) / 2).toFixed(3));

      let mitigated = false;
      let broken = false;

      // La mitigacion se cuenta despues de la vela que confirma el impulso/BOS.
      for (let j = confirmationIndex + 1; j < m5Candles.length; j++) {
        const postClose = Number(m5Candles[j].close);
        const postHigh = Number(m5Candles[j].high);
        const postLow = Number(m5Candles[j].low);

        if (!isBoom) {
          if (postClose > obHigh) {
            broken = true;
            break;
          }
          if (postHigh >= obMid50) mitigated = true;
        } else {
          if (postClose < obLow) {
            broken = true;
            break;
          }
          if (postLow <= obMid50) mitigated = true;
        }
      }

      // Protege tambien contra una invalidacion en la vela M5 aun abierta.
      if ((!isBoom && currentPrice > obHigh) || (isBoom && currentPrice < obLow)) {
        broken = true;
      }

      let status: OrderBlockPoint['status'] = 'FRESCO';
      let statusLabel = 'Fresco (Sin mitigar) 🎯';
      let statusSeverity: OrderBlockPoint['statusSeverity'] = 'success';
      const inZone = !broken && currentPrice >= obLow && currentPrice <= obHigh;

      if (broken) {
        status = 'INVALIDADO';
        statusLabel = 'Roto / Invalidado ❌';
        statusSeverity = 'negative';
      } else if (inZone) {
        status = 'EN_ZONA';
        statusLabel = isBoom ? '¡En Zona de Compra OB! ⚡' : '¡En Zona de Venta OB! ⚡';
        statusSeverity = 'warning';
      } else if (mitigated) {
        status = 'MITIGADO';
        statusLabel = 'Mitigado previamente 🔄';
        statusSeverity = 'info';
      }

      const distToPrice = parseFloat((isBoom ? currentPrice - obMid50 : obMid50 - currentPrice).toFixed(3));
      const timeStr = new Date(Number(c.epoch) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      list.push({
        epoch: Number(c.epoch),
        timeStr,
        timeframe: 'M5',
        high: obHigh,
        mid50: obMid50,
        low: obLow,
        open: parseFloat(cOpen.toFixed(3)),
        close: parseFloat(cClose.toFixed(3)),
        drop: parseFloat(spikeMagnitude.toFixed(2)),
        status,
        statusLabel,
        statusSeverity,
        distToPrice,
        inZone,
      });

      if (list.length >= 10) break;
    }

    // Solo un OB fresco o actualmente en zona puede estar activo. Los mitigados e
    // invalidados permanecen en el historial para diagnostico, sin dibujar entradas.
    let active: OrderBlockPoint | null = list.find((ob) => ob.status === 'EN_ZONA') || null;

    if (!active) {
      const freshList = list.filter((ob) => {
        if (ob.status !== 'FRESCO') return false;
        return isBoom ? ob.mid50 <= currentPrice : ob.mid50 >= currentPrice;
      });
      if (freshList.length > 0) {
        freshList.sort((a, b) => Math.abs(a.distToPrice) - Math.abs(b.distToPrice));
        active = freshList[0];
      }
    }

    return { active, list };
  }

  /**
   * Busca patrones V en M5 para CRASH pegados sobre la línea H1 (donde Low >= h1Price)
   */
  private findVPatternM5Crash(m5Candles: any[], h1Price: number): VPatternCandidate | null {
    if (!m5Candles || m5Candles.length < 3) return null;

    const candidates: VPatternCandidate[] = [];
    const maxDist = 1000.0;

    for (let k = m5Candles.length - 2; k >= 0; k--) {
      const c = m5Candles[k];
      const open = Number(c.open);
      const close = Number(c.close);
      const low = Number(c.low);
      const high = Number(c.high);

      // Vela roja (bajista)
      if (close >= open) continue;

      const vLinePrice = low;
      if (vLinePrice < h1Price) continue;

      const distToBlue = vLinePrice - h1Price;
      if (distToBlue > maxDist) continue;

      candidates.push({
        epoch: Number(c.epoch),
        timeStr: new Date(Number(c.epoch) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        priceLow: low,
        priceHigh: high,
        vLinePrice,
        distToBlue,
      });

      if (candidates.length >= 10) break;
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.distToBlue - b.distToBlue);
    return candidates[0];
  }

  /**
   * Busca patrones Lambda (V invertida) en M5 para BOOM pegados bajo la línea H1 (donde High <= h1Price)
   */
  private findVPatternM5Boom(m5Candles: any[], h1Price: number): VPatternCandidate | null {
    if (!m5Candles || m5Candles.length < 3) return null;

    const candidates: VPatternCandidate[] = [];
    const maxDist = 1000.0;

    for (let k = m5Candles.length - 2; k >= 0; k--) {
      const c = m5Candles[k];
      const open = Number(c.open);
      const close = Number(c.close);
      const low = Number(c.low);
      const high = Number(c.high);

      // Vela verde (spike alcista previo en Boom)
      if (close <= open) continue;

      const vLinePrice = high;
      // En Boom, el retroceso institucional se opera pegado y por debajo de la línea H1
      if (vLinePrice > h1Price) continue;

      const distToBlue = h1Price - vLinePrice;
      if (distToBlue > maxDist) continue;

      candidates.push({
        epoch: Number(c.epoch),
        timeStr: new Date(Number(c.epoch) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        priceLow: low,
        priceHigh: high,
        vLinePrice,
        distToBlue,
      });

      if (candidates.length >= 10) break;
    }

    if (candidates.length === 0) {
      // Fallback: Si no hay spike por debajo de H1, tomar la última vela verde significativa
      for (let k = m5Candles.length - 2; k >= Math.max(0, m5Candles.length - 30); k--) {
        const c = m5Candles[k];
        if (Number(c.close) > Number(c.open)) {
          return {
            epoch: Number(c.epoch),
            timeStr: new Date(Number(c.epoch) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            priceLow: Number(c.low),
            priceHigh: Number(c.high),
            vLinePrice: Number(c.high),
            distToBlue: Math.abs(Number(c.high) - h1Price),
          };
        }
      }
      return null;
    }

    candidates.sort((a, b) => a.distToBlue - b.distToBlue);
    return candidates[0];
  }

  /**
   * Calcula la altura típica de una vela M5 de movimiento continuo (excluyendo spikes gigantes).
   */
  private calculateM5CandleHeight(m5Candles: any[], symbol: string, isBoom: boolean): number {
    if (!m5Candles || m5Candles.length < 5) {
      return this.getDefaultM5Height(symbol);
    }

    const ranges: number[] = [];
    const slice = m5Candles.slice(-50);
    for (const c of slice) {
      const open = Number(c.open);
      const close = Number(c.close);
      const high = Number(c.high);
      const low = Number(c.low);
      const range = Math.max(high - low, 0.01);

      if (!isBoom) {
        // En Crash: velas verdes representan movimiento continuo normal de ticks
        if (close >= open) {
          ranges.push(range);
        } else if (range < 40) {
          ranges.push(range);
        }
      } else {
        // En Boom: velas rojas representan movimiento continuo normal de ticks
        if (close <= open) {
          ranges.push(range);
        } else if (range < 40) {
          ranges.push(range);
        }
      }
    }

    if (ranges.length < 5) return this.getDefaultM5Height(symbol);

    ranges.sort((a, b) => a - b);
    const median = ranges[Math.floor(ranges.length / 2)];
    return Math.max(median, this.getDefaultM5Height(symbol) * 0.5);
  }

  /**
   * Distancia mínima de Stop Loss por índice para evitar cierres prematuros por ruido de mercado.
   * Crash/Boom 100 y 200 cotizan en escala de ~95,000 a 105,000 pts (requieren holgura de 180 a 220 pts).
   */
  getMinSlPoints(symbol: string): number {
    const up = (symbol || '').toUpperCase();
    if (up.includes('1000')) return 25.0;
    if (up.includes('900')) return 30.0;
    if (up.includes('600')) return 25.0;
    if (up.includes('500')) return 25.0;
    if (up.includes('300')) return 20.0;
    if (up.includes('200')) return 220.0; // Crash / Boom 200 Index (~103,000 pts)
    if (up.includes('100')) return 180.0; // Crash / Boom 100 Index (~95,000 pts)
    return 25.0;
  }

  private getDefaultM5Height(symbol: string): number {
    const up = (symbol || '').toUpperCase();
    if (up.includes('1000')) return 4.5;
    if (up.includes('900')) return 3.5;
    if (up.includes('600')) return 2.8;
    if (up.includes('500')) return 2.2;
    if (up.includes('300')) return 1.5;
    if (up.includes('200')) return 20.0;
    if (up.includes('100')) return 18.0;
    return 2.5;
  }

  /**
   * Busca fractales estructurales en H1:
   * - En CRASH: Resistencia (fractal superior con caída posterior)
   * - En BOOM: Soporte (fractal inferior con rebote posterior)
   */
  private findH1StructuralLevel(h1Candles: any[], isBoom: boolean): number | null {
    if (!h1Candles || h1Candles.length < 7) return null;
    let bestLevel: number | null = null;

    if (!isBoom) {
      let maxHigh = 0;
      for (let i = h1Candles.length - 3; i >= Math.max(0, h1Candles.length - 50); i--) {
        const prev = Number(h1Candles[i - 1]?.high || 0);
        const curr = Number(h1Candles[i].high);
        const next = Number(h1Candles[i + 1]?.high || 0);

        if (curr > prev && curr > next) {
          if (curr > maxHigh) {
            maxHigh = curr;
            bestLevel = curr;
          }
        }
      }
    } else {
      let minLow = Infinity;
      for (let i = h1Candles.length - 3; i >= Math.max(0, h1Candles.length - 50); i--) {
        const prev = Number(h1Candles[i - 1]?.low || Infinity);
        const curr = Number(h1Candles[i].low);
        const next = Number(h1Candles[i + 1]?.low || Infinity);

        if (curr < prev && curr < next) {
          if (curr < minLow) {
            minLow = curr;
            bestLevel = curr;
          }
        }
      }
    }

    return bestLevel;
  }

  /**
   * Detecta si el precio en M5 se encuentra en una Zona de Retesteo / Consolidación Lateral.
   * En Crash 500 y otros índices, cuando el precio oscila en una banda horizontal estrecha
   * (velas M5 contenidas en un rango comprimido), está retesteando la zona / acumulando liquidez.
   * Operar dentro del rango lateral expone la cuenta al ruido y a ser sacado antes del verdadero spike.
   * Solo es viable para entrar si el precio testea el extremo (techo en Crash con rechazo / piso en Boom)
   * o rompe con fuerza el nivel de la consolidación.
   */
  private checkRetestConsolidationZone(
    m5Candles: any[],
    currentPrice: number,
    m5CandleHeight: number,
    isBoom: boolean,
    symbol: string,
  ): {
    isInRetest: boolean;
    isReadyForEntry: boolean;
    retestCeiling: number;
    retestFloor: number;
    retestRange: number;
    candleCount: number;
    reason: string;
  } {
    if (!m5Candles || m5Candles.length < 8) {
      return {
        isInRetest: false,
        isReadyForEntry: true,
        retestCeiling: 0,
        retestFloor: 0,
        retestRange: 0,
        candleCount: 0,
        reason: 'Sin suficientes velas para evaluar retesteo.',
      };
    }

    // Analizamos las últimas 8 velas M5 cerradas (40 minutos de mercado)
    const window = m5Candles.slice(-9, -1);
    const highs = window.map((c) => Number(c.high));
    const lows = window.map((c) => Number(c.low));
    const retestCeiling = Math.max(...highs);
    const retestFloor = Math.min(...lows);
    const retestRange = retestCeiling - retestFloor;

    const defaultHeight = this.getDefaultM5Height(symbol);
    const maxAllowedRange = Math.max(m5CandleHeight * 2.3, defaultHeight * 2.2);

    // Desplazamiento neto entre la primera y la última vela de la ventana
    const firstOpen = Number(window[0].open);
    const lastClose = Number(window[window.length - 1].close);
    const netDisplacement = Math.abs(lastClose - firstOpen);

    // Si el rango total de 8 velas M5 es muy estrecho y el desplazamiento neto es bajo,
    // estamos formalmente en una consolidación lateral / zona de retesteo
    const isLateralChop = retestRange <= maxAllowedRange && netDisplacement <= retestRange * 0.65;

    // Verificar además si el precio actual sigue contenido dentro de esta zona (con ligera tolerancia)
    const priceInZone =
      currentPrice >= retestFloor - m5CandleHeight * 0.35 &&
      currentPrice <= retestCeiling + m5CandleHeight * 0.35;

    const isInRetest = isLateralChop && priceInZone;

    if (!isInRetest) {
      return {
        isInRetest: false,
        isReadyForEntry: true,
        retestCeiling,
        retestFloor,
        retestRange,
        candleCount: window.length,
        reason: 'Estructura con direccionalidad normal (fuera de consolidación de retesteo).',
      };
    }

    // Evaluamos si la vela actual está en el extremo de rechazo o quiebre para poder entrar:
    const currentCandle = m5Candles[m5Candles.length - 1];
    const cHigh = Number(currentCandle.high);
    const cLow = Number(currentCandle.low);
    const cOpen = Number(currentCandle.open);
    const cClose = Number(currentCandle.close);
    const cBody = Math.abs(cClose - cOpen);

    if (!isBoom) {
      // ── CRASH (Venta)
      // En retesteo, solo se puede vender si:
      // a) El precio está testeando el techo de la consolidación con mecha de rechazo superior
      const upperWick = cHigh - Math.max(cOpen, cClose);
      const isTestingCeiling =
        currentPrice >= retestCeiling - m5CandleHeight * 0.35 &&
        (upperWick >= cBody * 0.4 || upperWick >= m5CandleHeight * 0.3);
      // b) O si quebró limpiamente el piso de la consolidación
      const isBreakingFloor = currentPrice < retestFloor - m5CandleHeight * 0.2;

      const isReadyForEntry = isTestingCeiling || isBreakingFloor;
      const reason = isReadyForEntry
        ? isTestingCeiling
          ? `En M5 el precio testeó el techo de consolidación (${retestCeiling.toFixed(2)}) con rechazo bajista.`
          : `En M5 el precio quebró a la baja el piso de la zona de retesteo (${retestFloor.toFixed(2)}).`
        : `El mercado se encuentra en zona de retesteo / consolidación lateral M5 (${retestFloor.toFixed(2)} - ${retestCeiling.toFixed(2)}). Aún no está para entrar: esperar prueba del techo (${retestCeiling.toFixed(2)}) con rechazo o quiebre confirmado.`;

      return {
        isInRetest: true,
        isReadyForEntry,
        retestCeiling,
        retestFloor,
        retestRange,
        candleCount: window.length,
        reason,
      };
    } else {
      // ── BOOM (Compra)
      // En retesteo, solo se puede comprar si:
      // a) El precio está testeando el piso de la consolidación con mecha de rechazo inferior
      const lowerWick = Math.min(cOpen, cClose) - cLow;
      const isTestingFloor =
        currentPrice <= retestFloor + m5CandleHeight * 0.35 &&
        (lowerWick >= cBody * 0.4 || lowerWick >= m5CandleHeight * 0.3);
      // b) O si quebró limpiamente el techo de la consolidación
      const isBreakingCeiling = currentPrice > retestCeiling + m5CandleHeight * 0.2;

      const isReadyForEntry = isTestingFloor || isBreakingCeiling;
      const reason = isReadyForEntry
        ? isTestingFloor
          ? `En M5 el precio testeó el piso de consolidación (${retestFloor.toFixed(2)}) con rechazo alcista.`
          : `En M5 el precio quebró al alza el techo de la zona de retesteo (${retestCeiling.toFixed(2)}).`
        : `El mercado se encuentra en zona de retesteo / consolidación lateral M5 (${retestFloor.toFixed(2)} - ${retestCeiling.toFixed(2)}). Aún no está para entrar: esperar prueba del piso (${retestFloor.toFixed(2)}) con rechazo o quiebre confirmado.`;

      return {
        isInRetest: true,
        isReadyForEntry,
        retestCeiling,
        retestFloor,
        retestRange,
        candleCount: window.length,
        reason,
      };
    }
  }

  /**
   * Detecta si en M5 el mercado ya reaccionó varias veces a la misma zona de soporte/resistencia,
   * lo que permite sugerir el trade incluso cuando la estructura no es un patrón V exacto.
   * IMPORTANTE: No se activa si el mercado está en consolidación lateral / chop plano de retesteo.
   */
  private detectRepeatedM5Reaction(
    m5Candles: any[],
    symbol: string,
    isBoom: boolean,
    currentPrice: number,
    boxFloor: number,
    boxCeiling: number,
    entryLevel50: number,
    isInRetestChop = false,
  ): { isDetected: boolean; reason: string; zoneDistance: number } {
    if (isInRetestChop) {
      return {
        isDetected: false,
        reason: 'El mercado se encuentra en zona de retesteo/consolidación lateral en M5; no se consideran reacciones repetidas en rango plano.',
        zoneDistance: Number.MAX_SAFE_INTEGER,
      };
    }

    if (!m5Candles || m5Candles.length < 12) {
      return { isDetected: false, reason: 'Sin suficientes velas M5 para validar reacciones repetidas.', zoneDistance: Number.MAX_SAFE_INTEGER };
    }

    // Zona real de reacción del patrón actual, no un promedio global de toda la última ventana.
    // Para CRASH la reacción que importa está en la zona superior (50% + techo de caja).
    // Para BOOM está en la zona inferior (50% + piso de caja).
    const reactionZone = isBoom
      ? (boxFloor + entryLevel50) / 2
      : (entryLevel50 + boxCeiling) / 2;
    const tolerance = Math.max(2.0, this.getDefaultM5Height(symbol) * 1.5);
    const window = m5Candles.slice(-30);

    let touches = 0;
    let lastTouchIdx = -10;
    for (let i = 0; i < window.length; i++) {
      const candle = window[i];
      const low = Number(candle.low);
      const high = Number(candle.high);
      const close = Number(candle.close);

      if (isBoom) {
        // BOOM: rebotes en soporte con separación mínima de velas entre contactos
        const insideZone = low <= reactionZone + tolerance && high >= reactionZone - tolerance;
        const bounced = close >= reactionZone - tolerance;
        if (insideZone && bounced && i - lastTouchIdx >= 2) {
          touches++;
          lastTouchIdx = i;
        }
      } else {
        // CRASH: rechazos en resistencia con separación mínima de velas entre contactos
        const insideZone = high >= reactionZone - tolerance && low <= reactionZone + tolerance;
        const bounced = close <= reactionZone + tolerance;
        if (insideZone && bounced && i - lastTouchIdx >= 2) {
          touches++;
          lastTouchIdx = i;
        }
      }
    }

    const zoneDistance = Math.abs(currentPrice - reactionZone);
    const minTouches = isBoom ? 2 : 3;
    const isDetected = touches >= minTouches && zoneDistance <= tolerance * 2.5;

    return {
      isDetected,
      reason: isDetected
        ? `El mercado ya reaccionó varias veces en M5 cerca de ${reactionZone.toFixed(3)}; se sugiere entrar por repetición de reacción.`
        : 'No hay suficientes reacciones repetidas en la zona M5 actual para sugerir entrada por reacción.',
      zoneDistance,
    };
  }

  /**
   * Cuenta velas M1 verdes consecutivas en Crash tras el último spike bajista.
   */
  private getConsecutiveGreenM1(m1Candles: any[]): number {
    if (!m1Candles || m1Candles.length === 0) return 0;
    let greenCount = 0;

    for (let i = m1Candles.length - 1; i >= 0; i--) {
      const open = Number(m1Candles[i].open);
      const close = Number(m1Candles[i].close);
      const low = Number(m1Candles[i].low);
      const high = Number(m1Candles[i].high);

      const isSpike = (open - close) > 3.0 || ((high - low) > 5.0 && close < open);
      if (isSpike) {
        break;
      }

      if (close >= open) {
        greenCount++;
      } else {
        break;
      }
    }

    return greenCount;
  }

  /**
   * Cuenta velas M1 rojas consecutivas en Boom tras el último spike alcista.
   */
  private getConsecutiveRedM1(m1Candles: any[]): number {
    if (!m1Candles || m1Candles.length === 0) return 0;
    let redCount = 0;

    for (let i = m1Candles.length - 1; i >= 0; i--) {
      const open = Number(m1Candles[i].open);
      const close = Number(m1Candles[i].close);
      const low = Number(m1Candles[i].low);
      const high = Number(m1Candles[i].high);

      const isSpike = (close - open) > 3.0 || ((high - low) > 5.0 && close > open);
      if (isSpike) {
        break;
      }

      if (close <= open) {
        redCount++;
      } else {
        break;
      }
    }

    return redCount;
  }

  /**
   * Filtro Vela Amiga H1:
   * - En Crash: Bloquea trade si la vela roja previa H1 cerró más abajo.
   * - En Boom: Bloquea trade si la vela previa H1 cerró rompiendo la estructura alcista hacia abajo.
   */
  private checkVelaAmigaH1(h1Candles: any[], isBoom: boolean): { velaAmigaOk: boolean; velaAmigaMsg: string } {
    if (!h1Candles || h1Candles.length < 3) {
      return { velaAmigaOk: true, velaAmigaMsg: 'Sin datos suficientes H1' };
    }

    const currentH1 = h1Candles[h1Candles.length - 1];
    const prevH1 = h1Candles[h1Candles.length - 2];

    const prevClose = Number(prevH1.close);
    const prevOpen = Number(prevH1.open);

    if (!isBoom) {
      const isPrevRed = prevClose < prevOpen;
      if (!isPrevRed) {
        return { velaAmigaOk: true, velaAmigaMsg: 'Vela H1 previa no fue bajista' };
      }

      const currentBase = Math.min(Number(currentH1.open), Number(currentH1.close));
      if (prevClose < currentBase) {
        return { velaAmigaOk: false, velaAmigaMsg: 'Bloqueado: Roja previa H1 cerró más abajo' };
      }

      return { velaAmigaOk: true, velaAmigaMsg: 'Vela Amiga H1 Aprobada' };
    } else {
      const isPrevGreen = prevClose > prevOpen;
      if (!isPrevGreen) {
        return { velaAmigaOk: true, velaAmigaMsg: 'Vela H1 previa en consolidación' };
      }

      const currentCeiling = Math.max(Number(currentH1.open), Number(currentH1.close));
      if (prevClose > currentCeiling) {
        return { velaAmigaOk: false, velaAmigaMsg: 'Bloqueado: Verde previa H1 cerró por encima' };
      }

      return { velaAmigaOk: true, velaAmigaMsg: 'Vela Amiga H1 Aprobada' };
    }
  }

  private calculateEMA(prices: number[], period: number): number {
    if (!prices || prices.length === 0) return 0;
    if (prices.length < period) return prices[prices.length - 1];

    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }

    return ema;
  }

  private calculateRSI(prices: number[], period = 14): number {
    if (!prices || prices.length <= period) return 50.0;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff >= 0) {
        avgGain = (avgGain * (period - 1) + diff) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
}
