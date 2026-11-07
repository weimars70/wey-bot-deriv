import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CandlesService } from '../candles/candles.service';
import { WatchedEntryLevel } from '../watched-levels/watched-level.entity';

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

export const SYMBOL_DRIFT_PER_MIN: Record<string, number> = {
  BOOM600: 0.51,
  BOOM1000: 0.95,
  BOOM500: 0.62,
  BOOM900: 0.70,
  BOOM300: 1.50,
  BOOM300N: 1.50,
  CRASH600: 0.97,
  CRASH1000: 0.36,
  CRASH500: 0.37,
  CRASH900: 0.45,
  CRASH300: 1.20,
  CRASH300N: 1.20,
};

export interface CrashIaGapLevel {
  id: string;
  price: number;
  direction: 'BUY' | 'SELL';
  status: string;
  note: string | null;
  distToPrice: number;
  inRetracement: boolean;
  minutesToArrival: number;
}

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
  gaps?: CrashIaGapLevel[];
  score?: number;
}

export interface SpikeRadarEntry {
  symbol:              string;
  mercado:             string;
  marketType:          'CRASH' | 'BOOM';
  operationType:       'SELL' | 'BUY';
  currentPrice:        number;
  entryLevel50:        number;
  stopLossPrice:       number;
  takeProfitPrice:     number;
  riskReward:          number;
  h1LinePrice:         number;
  vLinePrice:          number;
  obStatus:            'FRESCO' | 'EN_ZONA' | 'MITIGADO' | 'INVALIDADO';
  obMid50:             number;
  obDistToPrice:       number;
  rsi_M5:              number;
  trendM15:            'BAJISTA' | 'ALCISTA';
  m5ViabilityReason:   string;
  velaAmigaMsg:        string;
  score:               number;
  canSell:             boolean;
  canBuy:              boolean;
  sweepPrice?:         number;  // Extremo de la mecha que barrió la liquidez del OB (base del SL)
}

@Injectable()
export class CrashIaStrategyService {
  private readonly logger = new Logger(CrashIaStrategyService.name);
  private readonly evaluationCacheTtlMs = 15 * 1000;
  private readonly evaluationCache = new Map<string, { expiresAt: number; value: CrashIaEvaluation }>();
  private readonly evaluationsInFlight = new Map<string, Promise<CrashIaEvaluation>>();
  private readonly watchedLevelsCache = new Map<string, { expiresAt: number; rows: WatchedEntryLevel[] }>();
  private summaryCache: { expiresAt: number; value: Omit<CrashIaEvaluation, 'chartCandles'>[] } | null = null;
  private summaryInFlight: Promise<Omit<CrashIaEvaluation, 'chartCandles'>[]> | null = null;

  constructor(
    private readonly candlesService: CandlesService,
    @InjectRepository(WatchedEntryLevel)
    private readonly watchedLevelsRepo: Repository<WatchedEntryLevel>,
  ) {}

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
    const cacheKey = `${sym}:${timeframeMinutes}`;
    const cached = this.evaluationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const inFlight = this.evaluationsInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const evaluation = this.calculateSymbolEvaluation(sym, timeframeMinutes);
    this.evaluationsInFlight.set(cacheKey, evaluation);
    try {
      const value = await evaluation;
      this.evaluationCache.set(cacheKey, {
        expiresAt: Date.now() + this.evaluationCacheTtlMs,
        value,
      });
      return value;
    } finally {
      this.evaluationsInFlight.delete(cacheKey);
    }
  }

  private async calculateSymbolEvaluation(sym: string, timeframeMinutes: number): Promise<CrashIaEvaluation> {
    const isBoom = sym.startsWith('BOOM');
    const marketType: 'CRASH' | 'BOOM' = isBoom ? 'BOOM' : 'CRASH';
    const operationType: 'SELL' | 'BUY' = isBoom ? 'BUY' : 'SELL';

    const allDefs = [...CRASH_SYMBOLS, ...BOOM_SYMBOLS];
    const mercado = allDefs.find((s) => s.symbol === sym)?.name || sym;

    // 1. Obtener velas H1 (3600), M5 (300), M15 (900) y M1 (60) de forma secuencial para usar 1 sola conexión del pool
    const m5HistoryCount = 288; // ~24 horas de M5
    const m1HistoryCount = 500; // cubre los OB M5 buscados hasta ~6h40 atras
    const h1Raw = await this.candlesService.findLatest(sym, 3600, 100);
    const m5Raw = await this.candlesService.findLatest(sym, 300, m5HistoryCount);
    const m15Raw = await this.candlesService.findLatest(sym, 900, 100);
    const m1Raw = await this.candlesService.findLatest(sym, 60, m1HistoryCount);

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

    // 3. Altura de Vela M5 (mediana de velas M5 de movimiento continuo)
    const m5CandleHeight = this.calculateM5CandleHeight(m5Candles, sym, isBoom);

    // 4. Patrón V / Lambda Institucional en M5 (Reciente, con spike real, pegado a H1 y NO roto/mitigado)
    // En Crash: V normal (suelo en spike rojo previo sobre línea H1).
    // En Boom: Lambda invertida (techo en spike verde previo bajo línea H1).
    const vCandidate = isBoom
      ? this.findVPatternM5Boom(m5Candles, h1LinePrice, m5CandleHeight, sym)
      : this.findVPatternM5Crash(m5Candles, h1LinePrice, m5CandleHeight, sym);

    const vLinePrice = vCandidate ? vCandidate.vLinePrice : h1LinePrice;

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
      const rawSl = boxCeiling + (0.7 * m5CandleHeight);
      const safeBuffer = Math.min(minSlBuffer, m5CandleHeight * 0.8);
      stopLossPrice = Math.max(rawSl, currentPrice + safeBuffer, entryLevel50 + safeBuffer);
    } else {
      // ── BOOM: Caja proyectada hacia ABAJO (el precio retrocede cayendo hacia el soporte de compra)
      boxCeiling = vLinePrice;
      boxFloor = vLinePrice - (3 * m5CandleHeight);
      entryLevel50 = vLinePrice - (0.5 * 3 * m5CandleHeight); // 50% inferior / descuento institucional
      // Stop Loss con suficiente margen estructural y holgura adecuada (mínimo amplio para 100 y 200)
      const rawSl = boxFloor - (0.7 * m5CandleHeight);
      const safeBuffer = Math.min(minSlBuffer, m5CandleHeight * 0.8);
      stopLossPrice = Math.min(rawSl, currentPrice - safeBuffer, entryLevel50 - safeBuffer);
    }

    // 6. Nivel Estructural H1 (Fractal mayor: resistencia en Crash / soporte en Boom)
    const h1StructuralPrice = this.findH1StructuralLevel(h1Candles, isBoom);

    // 7. Filtro 1: Tendencia Macro Estricta (EMA 50 + EMA 21 + Pendiente en M15)
    const m15Closes = m15Candles.map((c) => Number(c.close));
    const ema50_M15 = this.calculateEMA(m15Closes, 50);
    const ema21_M15 = this.calculateEMA(m15Closes, 21);
    const ema50Prev_M15 = m15Closes.length > 4
      ? this.calculateEMA(m15Closes.slice(0, -3), 50)
      : ema50_M15;

    // REGLA USUARIO: "tratar de coger una tendencia" (Solo operar a favor de la tendencia institucional real)
    const isEmaBajista = ema21_M15 <= ema50_M15 && currentPrice <= ema50_M15 * 1.001;
    const isEmaAlcista = ema21_M15 >= ema50_M15 && currentPrice >= ema50_M15 * 0.999;

    const trendM15: 'BAJISTA' | 'ALCISTA' = (!isBoom && isEmaBajista)
      ? 'BAJISTA'
      : (isBoom && isEmaAlcista)
      ? 'ALCISTA'
      : (!isBoom && currentPrice < ema50_M15)
      ? 'BAJISTA'
      : (isBoom && currentPrice > ema50_M15)
      ? 'ALCISTA'
      : isBoom ? 'BAJISTA' : 'ALCISTA';

    // En Crash: Solo ventas si la estructura y EMAs en M15 son estrictamente BAJISTAS
    // En Boom: Solo compras si la estructura y EMAs en M15 son estrictamente ALCISTAS
    const trendOk = isBoom
      ? (trendM15 === 'ALCISTA' && isEmaAlcista)
      : (trendM15 === 'BAJISTA' && isEmaBajista);

    // 8. Filtro 2: RSI 14 en M5 (evitar zonas sobreextendidas en contra del spike)
    // En Crash: 28.0 <= RSI <= 78.0 (con margen para el retroceso antes de la caída)
    // En Boom: 22.0 <= RSI <= 72.0 (con margen para el retroceso antes de la subida)
    const rsi_M5 = this.calculateRSI(m5Candles.map((c) => Number(c.close)), 14);
    const rsiOk = isBoom ? (rsi_M5 <= 72.0 && rsi_M5 >= 22.0) : (rsi_M5 >= 28.0 && rsi_M5 <= 78.0);

    // 9. Filtro 3: Velas M1 de enfriamiento tras spike
    // Mínimo 2 velas de enfriamiento M1 hacia la zona de recarga
    const consecutiveGreenM1 = this.getConsecutiveGreenM1(m1Candles);
    const consecutiveRedM1 = this.getConsecutiveRedM1(m1Candles);
    const minGreenRequired = 2;
    const greenOk = isBoom
      ? consecutiveRedM1 >= minGreenRequired
      : consecutiveGreenM1 >= minGreenRequired;

    // 10. Filtro 4: Vela Amiga H1
    const { velaAmigaOk, velaAmigaMsg } = this.checkVelaAmigaH1(h1Candles, isBoom);

    // 11. Estado del Precio respecto a la Caja (entre Línea Morada vLinePrice y Línea Punteada 50% / Techo-Piso)
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
        statusLabel = '🎯 En Zona 50% - Techo (Zona de Entrada)';
        statusSeverity = 'warning';
      } else if (currentPrice >= boxFloor) {
        status = 'EN_BASE_CAJA';
        statusLabel = '🎯 En Zona Línea Morada -> 50% (Zona de Entrada)';
        statusSeverity = 'warning';
      } else {
        status = 'BAJO_ZONA';
        statusLabel = vCandidate ? 'Por debajo de la caja V' : 'Sin patrón V reciente sobre H1 (Esperando llegada a línea morada)';
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
        statusLabel = '🎯 En Zona 50% - Piso (Zona de Entrada)';
        statusSeverity = 'warning';
      } else if (currentPrice <= boxCeiling) {
        status = 'EN_BASE_CAJA';
        statusLabel = '🎯 En Zona Línea Morada -> 50% (Zona de Entrada)';
        statusSeverity = 'warning';
      } else {
        status = 'SOBRE_ZONA';
        statusLabel = vCandidate ? 'Por encima de la caja (esperando retroceso)' : 'Sin patrón Λ reciente bajo H1 (Esperando llegada a línea morada)';
        statusSeverity = 'info';
      }
    }

    // 12. Detección y ubicación de Puntos Order Block (OB) en temporalidad M5 (Solo FRESCOS, primer toque)
    const { active: activeOrderBlock, list: recentOrderBlocks } = this.findOrderBlocks(
      m5Candles,
      currentPrice,
      sym,
      isBoom,
    );

    // 13. Validación Rigurosa de Viabilidad en Temporalidad M5
    const m5Viability = this.checkM5ReactionViability(
      m5Candles,
      currentPrice,
      isBoom,
      activeOrderBlock,
      recentOrderBlocks,
      boxFloor,
      boxCeiling,
      entryLevel50,
      m5CandleHeight,
      Boolean(vCandidate),
    );

    // 13.1 Detección de Zona de Retesteo / Consolidación Lateral en M5
    const retestInfo = this.checkRetestConsolidationZone(
      m5Candles,
      currentPrice,
      m5CandleHeight,
      isBoom,
      sym,
    );

    if (retestInfo.isInRetest && retestInfo.isReadyForEntry && m5Viability.isViable) {
      m5Viability.reason = retestInfo.reason;
    }

    // REGLA USUARIO ZONAS V: Solo hacer el trade si el índice cumple con todo lo que tiene
    // (Patrón V/Λ u Order Block M5 válido, en zona entre Línea Morada y 50%, RSI M5 OK, enfriamiento M1 OK, viabilidad M5 OK)
    // Y QUE ADEMÁS ESTÉ EN TENDENCIA (trendOk === true en M15).
    const isInOrderBlock = Boolean(activeOrderBlock && activeOrderBlock.inZone);
    const hasValidStructure = Boolean(vCandidate) || isInOrderBlock;

    const inEntryZone =
      status === 'EN_BASE_CAJA' ||
      status === 'EN_ZONA_50' ||
      isInOrderBlock;

    const canSell = Boolean(
      !isBoom &&
        inEntryZone &&
        hasValidStructure &&
        trendOk &&
        rsiOk &&
        greenOk &&
        m5Viability.isViable,
    );
    const canBuy = Boolean(
      isBoom &&
        inEntryZone &&
        hasValidStructure &&
        trendOk &&
        rsiOk &&
        greenOk &&
        m5Viability.isViable,
    );

    if (canSell || canBuy) {
      statusLabel = isBoom
        ? '🎯 ZONA SNIPER CONFIRMADA EN TENDENCIA (BUY)'
        : '🎯 ZONA SNIPER CONFIRMADA EN TENDENCIA (SELL)';
      statusSeverity = 'success';
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

    // 15. Gaps / Niveles vigilados para este símbolo (BOOM BUY / CRASH SELL)
    let gaps: CrashIaGapLevel[] = [];
    try {
      const cleanSym = sym.replace(/[^A-Z0-9]/g, '');
      const cachedGaps = this.watchedLevelsCache.get(cleanSym);
      let rawGaps: WatchedEntryLevel[];
      if (cachedGaps && cachedGaps.expiresAt > Date.now()) {
        rawGaps = cachedGaps.rows;
      } else {
        rawGaps = await this.watchedLevelsRepo
          .createQueryBuilder('lvl')
          .where('lvl.status IN (:...statuses)', { statuses: ['PENDING', 'EVALUATING'] })
          .andWhere(
            "(REPLACE(UPPER(lvl.symbol), ' ', '') = :cleanSym OR :cleanSym LIKE CONCAT('%', REPLACE(UPPER(lvl.symbol), ' ', ''), '%'))",
            { cleanSym }
          )
          .getMany();
        this.watchedLevelsCache.set(cleanSym, {
          expiresAt: Date.now() + 15_000,
          rows: rawGaps,
        });
      }

      const drift = SYMBOL_DRIFT_PER_MIN[cleanSym] || 0.55;
      gaps = rawGaps
        .map((g) => {
          const p = Number(g.entryPrice);
          const dist = Math.abs(currentPrice - p);
          // En BOOM: retroceso si precio está por encima cayendo hacia el gap
          // En CRASH: retroceso si precio está por debajo subiendo hacia el gap
          const inRetracement = isBoom ? currentPrice > p : currentPrice < p;
          const minutesToArrival = drift > 0 ? parseFloat((dist / drift).toFixed(1)) : 0;
          return {
            id: g.id,
            price: parseFloat(p.toFixed(3)),
            direction: g.direction,
            status: g.status,
            note: g.note || null,
            distToPrice: parseFloat(dist.toFixed(3)),
            inRetracement,
            minutesToArrival,
          };
        })
        .sort((a, b) => a.distToPrice - b.distToPrice);
    } catch (e: any) {
      this.logger.debug(`Error cargando gaps para ${sym}: ${e?.message}`);
    }

    let evalScore = 40;
    if (inEntryZone) evalScore += 15;
    if (hasValidStructure) evalScore += 15;
    if (trendOk) evalScore += 15;
    if (rsiOk) evalScore += 5;
    if (greenOk) evalScore += 5;
    if (m5Viability && m5Viability.isViable) evalScore += 5;
    if (velaAmigaOk) evalScore += 5;
    if (activeOrderBlock && (activeOrderBlock.status === 'FRESCO' || activeOrderBlock.inZone)) evalScore += 5;
    if (!trendOk || !hasValidStructure) {
      evalScore = Math.min(evalScore, 65);
    }
    evalScore = Math.min(100, evalScore);

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
      gaps,
      retestZone: {
        isInRetest: retestInfo.isInRetest,
        isReadyForEntry: retestInfo.isReadyForEntry,
        retestCeiling: parseFloat(retestInfo.retestCeiling.toFixed(3)),
        retestFloor: parseFloat(retestInfo.retestFloor.toFixed(3)),
        retestRange: parseFloat(retestInfo.retestRange.toFixed(3)),
        reason: retestInfo.reason,
      },
      score: evalScore,
    };
  }

  /**
   * Spike Radar: retorna SOLO los índices con condiciones institucionales completas para spike inminente.
   * Criterios ultra-estrictos (deben cumplirse TODOS):
   *  1. canSell || canBuy  → señal verde completa
   *  2. vCandidate presente y fresco (spike real verificado)
   *  3. activeOrderBlock en status FRESCO o EN_ZONA con inZone = true
   *  4. m5Viability.isViable = true
   *  5. filters.velaAmigaOk = true
   *  6. filters.greenOk = true (velas de enfriamiento M1 listas)
   *  7. filters.trendOk = true (EMA50 M15 confirma dirección)
   *  8. activeOrderBlock.distToPrice <= 1.5 * m5CandleHeight  (precio dentro o muy cerca del OB)
   *  9. RSI M5 no sobreextendido: crash < 55, boom > 45
   */
  async getSpikeRadar(): Promise<SpikeRadarEntry[]> {
    const all: CrashIaEvaluation[] = [];
    for (const s of CRASH_BOOM_IA_SYMBOLS) {
      all.push(await this.evaluateSymbol(s.symbol, 5));
    }

    const radar: SpikeRadarEntry[] = [];
    for (const ev of all) {
      const isBoom = ev.marketType === 'BOOM';
      const ob = ev.activeOrderBlock;
      if (!ob || (ob.status !== 'FRESCO' && ob.status !== 'EN_ZONA')) continue;

      // 1. REGLA USUARIO: No entrar en zonas retail antes de tiempo ("esperar a que el mercado saque a todos").
      // El precio debe estar DENTRO del OB y en la mitad profunda de descuento/cazada (mid50 o superior en Crash, mid50 o inferior en Boom)
      if (!ob.inZone) continue;
      const inDeepDiscount = isBoom ? ev.currentPrice <= ob.mid50 : ev.currentPrice >= ob.mid50;
      if (!inDeepDiscount) continue;

      // 2. Velas de enfriamiento M1 (mínimo 3 velas para dar tiempo a la cazada y retroceso)
      const coolingOk = isBoom
        ? ev.filters.consecutiveRedM1 >= 3
        : ev.filters.consecutiveGreenM1 >= 3;
      if (!coolingOk) continue;

      // 3. REGLA USUARIO: "tratar de coger una tendencia" (Tendencia M15 estricta, no operar contra-tendencia)
      if (!ev.filters.trendOk) continue;

      // 4. RSI institucional saludable (sin extremos contra-tendencia)
      const rsi = ev.filters.rsi_M5;
      const rsiOk = isBoom
        ? (rsi >= 28 && rsi <= 65)
        : (rsi >= 35 && rsi <= 72);
      if (!rsiOk) continue;

      // 5. Vela Amiga H1 a favor
      if (!ev.filters.velaAmigaOk) continue;

      // 6. Viabilidad M5 confirmada (rechazo o desaceleración en zona institucional)
      if (!ev.m5Viability?.isViable) continue;

      // 6.1 CAZADA DE LIQUIDEZ CONFIRMADA (evitar la entrada "obvia" del primer toque al OB).
      // Exige que una vela M5 reciente haya perforado el extremo del OB (sacando los SL retail)
      // y que la última vela cerrada haya vuelto a cerrar dentro del OB (rechazo).
      const sweep = this.detectLiquiditySweep(ev.chartCandles, ob, isBoom);
      if (!sweep) continue;

      // 7. Cálculo riguroso de Score Institucional Sniper (máx 100)
      let score = 50;
      if (ev.filters.trendOk) score += 15;
      if (ev.filters.velaAmigaOk) score += 10;
      if (inDeepDiscount) score += 10;
      if (ev.m5Viability?.isViable) score += 5;
      if (ev.vCandidate) score += 5;
      if (isBoom && rsi >= 35 && rsi <= 55) score += 5;
      if (!isBoom && rsi >= 45 && rsi <= 65) score += 5;

      // 8. FILTRO ULTRA-SNIPER ESTRICTO: Solo emitir señales de alta convicción (score >= 80)
      // "menos señales y tratar de coger una tendencia"
      if (score < 80) continue;

      // Entrada al precio real (tras el rechazo) y SL justo detrás de la mecha de la cazada:
      // SL estructural más ajustado que el anterior (OB + 0.4 velas), alineado con el riesgo en USD.
      const entryPrice = ev.currentPrice;
      const slBuffer = ev.m5CandleHeight * 0.25;
      const stopLossPrice = isBoom
        ? Math.min(sweep.sweepPrice - slBuffer, ev.currentPrice - slBuffer)
        : Math.max(sweep.sweepPrice + slBuffer, ev.currentPrice + slBuffer);

      const actualRisk = Math.max(Math.abs(entryPrice - stopLossPrice), ev.m5CandleHeight * 0.5);
      const takeProfitPrice = isBoom
        ? Number((entryPrice + 3.0 * actualRisk).toFixed(2))
        : Number((entryPrice - 3.0 * actualRisk).toFixed(2));
      const riskReward = 3.0;

      radar.push({
        symbol:         ev.symbol,
        mercado:        ev.mercado,
        marketType:     ev.marketType,
        operationType:  ev.operationType,
        currentPrice:   ev.currentPrice,
        entryLevel50:   parseFloat(entryPrice.toFixed(3)),
        stopLossPrice:  parseFloat(stopLossPrice.toFixed(3)),
        takeProfitPrice,
        riskReward,
        h1LinePrice:    ev.h1LinePrice,
        vLinePrice:     ev.vLinePrice,
        obStatus:       ob.status,
        obMid50:        ob.mid50,
        obDistToPrice:  parseFloat(ob.distToPrice.toFixed(3)),
        rsi_M5:         parseFloat(rsi.toFixed(1)),
        trendM15:       ev.filters.trendM15,
        m5ViabilityReason: ev.m5Viability.reason,
        velaAmigaMsg:   ev.filters.velaAmigaMsg,
        score:          Math.min(100, score),
        canSell:        !isBoom,
        canBuy:         isBoom,
        sweepPrice:     parseFloat(sweep.sweepPrice.toFixed(3)),
      });
    }

    return radar.sort((a, b) => b.score - a.score);
  }

  /**
   * Detecta una cazada de liquidez (liquidity sweep) sobre el Order Block en M5:
   *  - CRASH (SELL): una de las últimas velas cerradas tuvo high > ob.high y la última vela cerrada
   *    cerró de nuevo por debajo de ob.high (rechazo). El precio actual sigue por debajo del barrido.
   *  - BOOM (BUY): espejo con ob.low.
   * Retorna el extremo del barrido (para colocar el SL detrás) o null si no hay confirmación.
   */
  private detectLiquiditySweep(
    candles: { open: number; high: number; low: number; close: number }[],
    ob: OrderBlockPoint,
    isBoom: boolean,
    lookback = 6,
  ): { sweepPrice: number } | null {
    if (!candles || candles.length < 3) return null;
    // La última vela es la que se está formando: solo usar velas cerradas
    const closed = candles.slice(0, -1);
    const lastClosed = closed[closed.length - 1];
    const current = candles[candles.length - 1];
    const window = closed.slice(-lookback);

    if (!isBoom) {
      const pierced = window.filter((c) => c.high > ob.high);
      if (!pierced.length) return null;
      const sweepPrice = Math.max(...pierced.map((c) => c.high));
      const rejected = lastClosed.close < ob.high && lastClosed.close <= lastClosed.open;
      if (!rejected || current.close >= sweepPrice) return null;
      return { sweepPrice };
    }

    const pierced = window.filter((c) => c.low < ob.low);
    if (!pierced.length) return null;
    const sweepPrice = Math.min(...pierced.map((c) => c.low));
    const rejected = lastClosed.close > ob.low && lastClosed.close >= lastClosed.open;
    if (!rejected || current.close <= sweepPrice) return null;
    return { sweepPrice };
  }

  /**
   * Resumen rápido de todos los índices Crash y Boom (secuencial para no abrir múltiples conexiones en BD).
   */
  async getSummaryAll(): Promise<Omit<CrashIaEvaluation, 'chartCandles'>[]> {
    if (this.summaryCache && this.summaryCache.expiresAt > Date.now()) {
      return this.summaryCache.value;
    }
    if (this.summaryInFlight) {
      return this.summaryInFlight;
    }

    this.summaryInFlight = (async () => {
      try {
        const list: CrashIaEvaluation[] = [];
        for (const s of CRASH_BOOM_IA_SYMBOLS) {
          try {
            list.push(await this.evaluateSymbol(s.symbol, 5));
          } catch (e: any) {
            this.logger.warn(`Error evaluando ${s.symbol} en getSummaryAll: ${e?.message}`);
          }
        }
        const mapped = list.map(({ chartCandles, ...rest }) => rest);
        this.summaryCache = {
          expiresAt: Date.now() + 15000,
          value: mapped,
        };
        return mapped;
      } finally {
        this.summaryInFlight = null;
      }
    })();

    return this.summaryInFlight;
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
    const results: Array<Awaited<ReturnType<CrashIaStrategyService['evaluateDoubleWickMecha']>>> = [];
    for (const s of CRASH_BOOM_IA_SYMBOLS) {
      results.push(await this.evaluateDoubleWickMecha(s.symbol));
    }
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
    const results: Array<Awaited<ReturnType<CrashIaStrategyService['evaluateDoubleWickMecha']>>> = [];
    for (const s of CRASH_BOOM_IA_SYMBOLS) {
      results.push(await this.evaluateDoubleWickMecha(s.symbol, 3600));
    }
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
    m5CandleHeight: number = 2.5,
    hasValidVPattern: boolean = true,
  ): {
    isViable: boolean;
    reason: string;
    targetReactionPrice: number;
    distToReaction: number;
    reactionType: 'ORDER_BLOCK_M5' | 'SOPORTE_ESTRUCTURAL_M5' | 'RESISTENCIA_ESTRUCTURAL_M5' | 'RETROCESO_50_M5';
  } {
    // 1. Prioridad Principal: Order Block Institucional FRESCO (Primer toque no mitigado) en M5
    if (activeOB && (activeOB.status === 'EN_ZONA' || activeOB.status === 'FRESCO')) {
      const targetReactionPrice = activeOB.mid50;
      const obSpan = Math.max(activeOB.high - activeOB.low, 0.5);
      const tolerance = Math.min(obSpan * 0.35, m5CandleHeight * 0.5);
      const distToReaction = parseFloat(
        ((isBoom ? currentPrice - targetReactionPrice : targetReactionPrice - currentPrice)).toFixed(3),
      );

      const inOptimalEntryBand = isBoom
        ? currentPrice <= activeOB.high + tolerance && currentPrice >= activeOB.low - tolerance
        : currentPrice >= activeOB.low - tolerance && currentPrice <= activeOB.high + tolerance;

      if (inOptimalEntryBand) {
        return {
          isViable: true,
          reason: `Zona Order Block Fresco M5 activa (${activeOB.low} - ${activeOB.high}) en confluencia con Línea Morada`,
          targetReactionPrice,
          distToReaction,
          reactionType: 'ORDER_BLOCK_M5',
        };
      }
    }

    // 2. Segunda opción: Cluster Real de Doble/Triple Rechazo de Spikes en el MISMO nivel
    if (m5Candles && m5Candles.length >= 12) {
      const clusterTolerance = Math.max(m5CandleHeight * 0.55, 1.2);
      const minSpikePts = Math.max(m5CandleHeight * 1.6, 4.0);

      if (isBoom) {
        const spikeOrigins: number[] = [];
        for (let i = m5Candles.length - 2; i >= Math.max(0, m5Candles.length - 36); i--) {
          const c = m5Candles[i];
          const next = m5Candles[i + 1];
          if (Number(next.close) - Number(next.open) >= minSpikePts) {
            spikeOrigins.push(Math.min(Number(c.low), Number(next.low)));
          }
        }

        let bestClusterPrice: number | null = null;
        for (const basePrice of spikeOrigins) {
          const touches = spikeOrigins.filter((p) => Math.abs(p - basePrice) <= clusterTolerance);
          if (touches.length >= 2 && basePrice <= boxCeiling + clusterTolerance && basePrice >= boxFloor - clusterTolerance) {
            bestClusterPrice = parseFloat((touches.reduce((a, b) => a + b, 0) / touches.length).toFixed(3));
            break;
          }
        }

        if (bestClusterPrice !== null) {
          const distToReaction = parseFloat((currentPrice - bestClusterPrice).toFixed(3));
          const nearSupport = Math.abs(distToReaction) <= clusterTolerance;
          if (nearSupport) {
            return {
              isViable: true,
              reason: `Doble/Triple soporte institucional de spikes confirmado en ${bestClusterPrice}`,
              targetReactionPrice: bestClusterPrice,
              distToReaction,
              reactionType: 'SOPORTE_ESTRUCTURAL_M5',
            };
          }
        }
      } else {
        const spikeOrigins: number[] = [];
        for (let i = m5Candles.length - 2; i >= Math.max(0, m5Candles.length - 36); i--) {
          const c = m5Candles[i];
          const next = m5Candles[i + 1];
          if (Number(next.open) - Number(next.close) >= minSpikePts) {
            spikeOrigins.push(Math.max(Number(c.high), Number(next.high)));
          }
        }

        let bestClusterPrice: number | null = null;
        for (const topPrice of spikeOrigins) {
          const touches = spikeOrigins.filter((p) => Math.abs(p - topPrice) <= clusterTolerance);
          if (touches.length >= 2 && topPrice >= boxFloor - clusterTolerance && topPrice <= boxCeiling + clusterTolerance) {
            bestClusterPrice = parseFloat((touches.reduce((a, b) => a + b, 0) / touches.length).toFixed(3));
            break;
          }
        }

        if (bestClusterPrice !== null) {
          const distToReaction = parseFloat((bestClusterPrice - currentPrice).toFixed(3));
          const nearResistance = Math.abs(distToReaction) <= clusterTolerance;
          if (nearResistance) {
            return {
              isViable: true,
              reason: `Doble/Triple resistencia institucional de spikes confirmada en ${bestClusterPrice}`,
              targetReactionPrice: bestClusterPrice,
              distToReaction,
              reactionType: 'RESISTENCIA_ESTRUCTURAL_M5',
            };
          }
        }
      }
    }

    // 3. Zona de Línea Morada a Línea Punteada 50% (solo si el índice realmente tiene un patrón V/Λ activo):
    const inPurpleToBoxZone = isBoom
      ? currentPrice <= boxCeiling && currentPrice >= boxFloor
      : currentPrice >= boxFloor && currentPrice <= boxCeiling;

    const targetReactionPrice = parseFloat((isBoom ? boxCeiling : boxFloor).toFixed(3));
    const distToReaction = parseFloat(Math.abs(currentPrice - targetReactionPrice).toFixed(3));
    if (!hasVPattern) {
      return {
        isViable: false,
        reason: `Sin patrón V/Λ reciente ni Order Block activo en M5 (esperando formación de estructura)`,
        targetReactionPrice,
        distToReaction,
        reactionType: 'RETROCESO_50_M5',
      };
    }
    return {
      isViable: inPurpleToBoxZone,
      reason: inPurpleToBoxZone
        ? `Precio en zona activa con Patrón V/Λ entre Línea Morada (${targetReactionPrice}) y 50% (${entryLevel50.toFixed(2)})`
        : `Esperando llegada a la Línea Morada (${targetReactionPrice}; dist ${distToReaction} pts)`,
      targetReactionPrice,
      distToReaction,
      reactionType: 'RETROCESO_50_M5',
    };
  }

  /**
   * Verifica que el precio al entrar al Order Block muestre desaceleración o mecha de rechazo
   * ANTES de que ocurra el spike (sin esperar a que el spike ya haya cerrado toda la vela M5).
   */
  private hasOrderBlockRejectionOrDeceleration(
    m5Candles: any[],
    isBoom: boolean,
    zoneLow: number,
    zoneHigh: number,
  ): boolean {
    if (!m5Candles || m5Candles.length < 3) return false;

    const current = m5Candles[m5Candles.length - 1];
    const prev = m5Candles[m5Candles.length - 2];

    const cOpen = Number(current.open);
    const cClose = Number(current.close);
    const cHigh = Number(current.high);
    const cLow = Number(current.low);
    const cBody = Math.abs(cClose - cOpen);

    const pOpen = Number(prev.open);
    const pClose = Number(prev.close);
    const pBody = Math.abs(pClose - pOpen);

    const touchedZone =
      (cLow <= zoneHigh && cHigh >= zoneLow) ||
      (Number(prev.low) <= zoneHigh && Number(prev.high) >= zoneLow);
    if (!touchedZone) return false;

    if (!isBoom) {
      // En Crash (SELL): Mecha superior de rechazo tras el barrido / sweep de liquidez
      if (cClose > zoneHigh + 1.0) return false;
      const upperWick = cHigh - Math.max(cOpen, cClose);
      const prevUpperWick = Number(prev.high) - Math.max(pOpen, pClose);
      const hasWickRejection = upperWick >= cBody * 0.35 || prevUpperWick >= pBody * 0.35 || upperWick >= 2.0;
      const hasDeceleration = (cBody <= pBody * 0.70) || (cClose <= cOpen);
      return hasWickRejection || hasDeceleration;
    } else {
      // En Boom (BUY): Mecha inferior de rechazo tras el barrido / sweep de liquidez
      if (cClose < zoneLow - 1.0) return false;
      const lowerWick = Math.min(cOpen, cClose) - cLow;
      const prevLowerWick = Math.min(pOpen, pClose) - Number(prev.low);
      const hasWickRejection = lowerWick >= cBody * 0.35 || prevLowerWick >= pBody * 0.35 || lowerWick >= 2.0;
      const hasDeceleration = (cBody <= pBody * 0.70) || (cClose >= cOpen);
      return hasWickRejection || hasDeceleration;
    }
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
   * - Evalúa el estado: FRESCO (Sin mitigar), EN_ZONA (solo en el PRIMER toque), MITIGADO o INVALIDADO.
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

    // Solo buscamos Order Blocks recientes (últimas 48 velas M5 = 4 horas)
    for (let i = lastClosedIndex - 1; i >= Math.max(3, m5Candles.length - 48); i--) {
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
      let previouslyMitigated = false;
      let broken = false;
      const currentHourStartEpoch = Math.floor(Date.now() / 3_600_000) * 3600;

      // Evaluar historial posterior a la confirmación del impulso
      for (let j = confirmationIndex + 1; j < m5Candles.length; j++) {
        const postClose = Number(m5Candles[j].close);
        const postHigh = Number(m5Candles[j].high);
        const postLow = Number(m5Candles[j].low);
        const postEpoch = Number(m5Candles[j].epoch) || 0;
        const isOldCandleOutsideHour = j < m5Candles.length - 2 && postEpoch < currentHourStartEpoch;

        if (!isBoom) {
          if (postClose > obHigh && postEpoch < currentHourStartEpoch) {
            broken = true;
            break;
          }
          if (postHigh >= obMid50) {
            mitigated = true;
            if (isOldCandleOutsideHour) previouslyMitigated = true;
          }
        } else {
          if (postClose < obLow && postEpoch < currentHourStartEpoch) {
            broken = true;
            break;
          }
          if (postLow <= obMid50) {
            mitigated = true;
            if (isOldCandleOutsideHour) previouslyMitigated = true;
          }
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
      } else if (previouslyMitigated) {
        // Si ya fue tocado en velas anteriores, queda marcado como MITIGADO aunque el precio vuelva a pasar por ahí
        status = 'MITIGADO';
        statusLabel = 'Ya mitigado (Descartado) 🔄';
        statusSeverity = 'info';
      } else if (inZone) {
        status = 'EN_ZONA';
        statusLabel = isBoom ? '¡1er Toque OB Compra! ⚡' : '¡1er Toque OB Venta! ⚡';
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
        inZone: inZone && !previouslyMitigated,
      });

      if (list.length >= 10) break;
    }

    // Solo un OB fresco (o en su 1er toque actual) puede estar activo.
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
   * Busca patrones V institucionales en M5 para CRASH pegados sobre la línea H1:
   * - Exige que la vela V sea un spike bajista real (no una micro-vela).
   * - Solo en las últimas 36 velas M5 (3 horas) y cerca de la línea H1.
   * - Verifica que la caja V no haya sido rota ni mitigada ya con un spike posterior.
   */
  private findVPatternM5Crash(
    m5Candles: any[],
    h1Price: number,
    m5CandleHeight: number = 2.5,
    symbol: string = 'CRASH500',
  ): VPatternCandidate | null {
    if (!m5Candles || m5Candles.length < 4) return null;

    const candidates: VPatternCandidate[] = [];
    const minSpikeDrop = Math.max(this.getMinSpikeDropForOB(symbol) * 0.7, m5CandleHeight * 1.4);
    const maxDist = Math.max(m5CandleHeight * 8.0, minSpikeDrop * 2.5);
    const lookbackStart = Math.max(1, m5Candles.length - 36); // Últimas 3 horas

    for (let k = m5Candles.length - 2; k >= lookbackStart; k--) {
      const c = m5Candles[k];
      const open = Number(c.open);
      const close = Number(c.close);
      const low = Number(c.low);
      const high = Number(c.high);

      // Exigir vela bajista de spike real (caída significativa)
      const drop = open - close;
      if (drop < minSpikeDrop) continue;

      const vLinePrice = low;
      if (vLinePrice < h1Price) continue;

      const distToBlue = vLinePrice - h1Price;
      if (distToBlue > maxDist) continue;

      // Validar que la caja proyectada desde este pico V NO haya sido invalidada ni gastada en horas anteriores
      // REGLA USUARIO: Si dentro de la MISMA HORA el precio vuelve a la zona tras salir en SL o Trailing Stop, se vuelve a operar.
      const candidateCeiling = vLinePrice + 3.0 * m5CandleHeight;
      const candidateMid50 = vLinePrice + 1.5 * m5CandleHeight;
      const currentHourStartEpoch = Math.floor(Date.now() / 3_600_000) * 3600;
      let invalidatedOrSpent = false;
      let touchedMid50 = false;

      for (let j = k + 1; j < m5Candles.length - 1; j++) {
        const post = m5Candles[j];
        const postClose = Number(post.close);
        const postHigh = Number(post.high);
        const postDrop = Number(post.open) - postClose;
        const postEpoch = Number(post.epoch) || 0;
        const isSameHour = postEpoch >= currentHourStartEpoch;

        // 1. Si el precio cerró superando el techo de la caja V en una hora anterior, la zona falló
        if (!isSameHour && postClose > candidateCeiling + m5CandleHeight * 0.35) {
          invalidatedOrSpent = true;
          break;
        }
        // 2. Solo se marca como gastada si reaccionó en una hora ANTERIOR (dentro de la misma hora se permite re-entrada al volver a la zona)
        if (!isSameHour && touchedMid50 && postDrop >= minSpikeDrop) {
          invalidatedOrSpent = true;
          break;
        }
        if (postHigh >= candidateMid50) {
          touchedMid50 = true;
        }
      }

      if (invalidatedOrSpent) continue;

      candidates.push({
        epoch: Number(c.epoch),
        timeStr: new Date(Number(c.epoch) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        priceLow: low,
        priceHigh: high,
        vLinePrice,
        distToBlue,
      });

      if (candidates.length >= 6) break;
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.distToBlue - b.distToBlue);
    return candidates[0];
  }

  /**
   * Busca patrones Lambda (V invertida) institucionales en M5 para BOOM pegados bajo la línea H1:
   * - Exige que la vela Λ sea un spike alcista real.
   * - Solo en las últimas 36 velas M5 (3 horas) y cerca de la línea H1 (sin fallback falso sobre H1).
   * - Verifica que la caja Λ no haya sido rota ni gastada ya con un spike posterior.
   */
  private findVPatternM5Boom(
    m5Candles: any[],
    h1Price: number,
    m5CandleHeight: number = 2.5,
    symbol: string = 'BOOM500',
  ): VPatternCandidate | null {
    if (!m5Candles || m5Candles.length < 4) return null;

    const candidates: VPatternCandidate[] = [];
    const minSpikeJump = Math.max(this.getMinSpikeDropForOB(symbol) * 0.7, m5CandleHeight * 1.4);
    const maxDist = Math.max(m5CandleHeight * 8.0, minSpikeJump * 2.5);
    const lookbackStart = Math.max(1, m5Candles.length - 36); // Últimas 3 horas

    for (let k = m5Candles.length - 2; k >= lookbackStart; k--) {
      const c = m5Candles[k];
      const open = Number(c.open);
      const close = Number(c.close);
      const low = Number(c.low);
      const high = Number(c.high);

      // Exigir vela alcista de spike real (subida significativa)
      const jump = close - open;
      if (jump < minSpikeJump) continue;

      const vLinePrice = high;
      // En Boom, el retroceso institucional se opera estrictamente pegado y por debajo de la línea H1
      if (vLinePrice > h1Price) continue;

      const distToBlue = h1Price - vLinePrice;
      if (distToBlue > maxDist) continue;

      // Validar que la caja proyectada desde este pico Λ NO haya sido invalidada ni gastada en horas anteriores
      // REGLA USUARIO: Si dentro de la MISMA HORA el precio vuelve a la zona tras salir en SL o Trailing Stop, se vuelve a operar.
      const candidateFloor = vLinePrice - 3.0 * m5CandleHeight;
      const candidateMid50 = vLinePrice - 1.5 * m5CandleHeight;
      const currentHourStartEpoch = Math.floor(Date.now() / 3_600_000) * 3600;
      let invalidatedOrSpent = false;
      let touchedMid50 = false;

      for (let j = k + 1; j < m5Candles.length - 1; j++) {
        const post = m5Candles[j];
        const postClose = Number(post.close);
        const postLow = Number(post.low);
        const postJump = postClose - Number(post.open);
        const postEpoch = Number(post.epoch) || 0;
        const isSameHour = postEpoch >= currentHourStartEpoch;

        // 1. Si el precio cerró perforando el piso de la caja Λ en una hora anterior, la zona falló
        if (!isSameHour && postClose < candidateFloor - m5CandleHeight * 0.35) {
          invalidatedOrSpent = true;
          break;
        }
        // 2. Solo se marca como gastada si reaccionó en una hora ANTERIOR (dentro de la misma hora se permite re-entrada al volver a la zona)
        if (!isSameHour && touchedMid50 && postJump >= minSpikeJump) {
          invalidatedOrSpent = true;
          break;
        }
        if (postLow <= candidateMid50) {
          touchedMid50 = true;
        }
      }

      if (invalidatedOrSpent) continue;

      candidates.push({
        epoch: Number(c.epoch),
        timeStr: new Date(Number(c.epoch) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        priceLow: low,
        priceHigh: high,
        vLinePrice,
        distToBlue,
      });

      if (candidates.length >= 6) break;
    }

    if (candidates.length === 0) return null;

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
        const prevBody = prevClose - prevOpen;
        const currentH1Height = Math.abs(Number(currentH1.high) - Number(currentH1.low)) || 1.0;
        if (prevBody > currentH1Height * 3.0 && Number(currentH1.close) > Number(prevH1.high)) {
          return { velaAmigaOk: false, velaAmigaMsg: 'Bloqueado: Impulso alcista H1 fuerte en contra' };
        }
        return { velaAmigaOk: true, velaAmigaMsg: 'Vela H1 previa no fue bajista' };
      }
      return { velaAmigaOk: true, velaAmigaMsg: 'Vela Amiga H1 Aprobada' };
    } else {
      const isPrevGreen = prevClose > prevOpen;
      if (!isPrevGreen) {
        const prevBody = prevOpen - prevClose;
        const currentH1Height = Math.abs(Number(currentH1.high) - Number(currentH1.low)) || 1.0;
        if (prevBody > currentH1Height * 3.0 && Number(currentH1.close) < Number(prevH1.low)) {
          return { velaAmigaOk: false, velaAmigaMsg: 'Bloqueado: Impulso bajista H1 fuerte en contra' };
        }
        return { velaAmigaOk: true, velaAmigaMsg: 'Vela H1 previa en consolidación' };
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
