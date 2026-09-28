import { Injectable, Logger } from '@nestjs/common';
import { CandlesService } from '../candles/candles.service';
import { CRASH_BOOM_KNOWN_SYMBOLS } from '../signals/signals.service';

export interface H1CandleAnalysis {
  epoch: number;
  timeStr: string;
  hourStr: string;
  open: number;
  high: number;
  low: number;
  close: number;
  body: number;
  range: number;
  upperWick: number;
  lowerWick: number;
  isBullish: boolean;
  isNoWickBoth: boolean;
  noUpperWick: boolean;
  noLowerWick: boolean;
  isInProgress: boolean;
}

export interface H1HistoricalReaction {
  found: boolean;
  count: number;
  level: number;
  tolerancePoints: number;
  lastReactionAt: string | null;
  lastDirection: 'ALCISTA' | 'BAJISTA' | null;
  lastMovePoints: number;
}

export interface H1IndexResult {
  symbol: string;
  mercado: string;
  h4Trend: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL';
  candles24h: H1CandleAnalysis[];
  noWickCount24h: number;
  latestCompleted: H1CandleAnalysis | null;
  hasActiveAlert: boolean;
  activeAlertReason: string | null;
  historicalReaction: H1HistoricalReaction | null;
}

export interface H1StrategySummary {
  indices: H1IndexResult[];
  activeAlerts: {
    symbol: string;
    mercado: string;
    direction: 'ALCISTA' | 'BAJISTA';
    epoch?: number;
    closedAt: string;
    open: number;
    close: number;
    body: number;
    message: string;
    isAnticipated?: boolean;
    secondsToClose?: number;
    h4Trend: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL';
    h4AgainstTrade: boolean;
    historicalReaction: H1HistoricalReaction;
  }[];
  nextHourChangeAt: string;
  secondsToNextHour: number;
  computedAt: string;
}

export interface H1SignalEvent {
  id: string;
  symbol: string;
  mercado: string;
  marketType: 'CRASH' | 'BOOM';
  direction: 'SELL' | 'BUY';
  signalEpoch: number;
  signalTimeStr: string;
  monthKey: string;
  monthLabel: string;
  weekKey: string;
  weekLabel: string;
  signalCandle: {
    open: number;
    high: number;
    low: number;
    close: number;
    body: number;
    range: number;
    upperWick: number;
    lowerWick: number;
  };
  nextCandle: {
    epoch: number;
    timeStr: string;
    open: number;
    high: number;
    low: number;
    close: number;
    body: number;
  };
  entryPrice: number;
  exitPrice: number;
  pnlClosePoints: number;
  maxProfitPoints: number;
  maxDrawdownPoints: number;
  pnlPercent: number;
  isProfitClose: boolean;
  isProfitPeak: boolean;
}

export interface H1SymbolStatistics {
  symbol: string;
  mercado: string;
  marketType: 'CRASH' | 'BOOM';
  totalSignals: number;
  winCloseCount: number;
  winPeakCount: number;
  lossCloseCount: number;
  winRateClosePct: number;
  winRatePeakPct: number;
  totalPnlPoints: number;
  avgPnlPoints: number;
  bestWinPoints: number;
  worstLossPoints: number;
}

export interface H1WeekStatistics {
  weekKey: string;
  weekLabel: string;
  monthKey: string;
  totalSignals: number;
  winCloseCount: number;
  winPeakCount: number;
  winRateClosePct: number;
  winRatePeakPct: number;
  totalPnlPoints: number;
  bySymbol: Array<{
    symbol: string;
    mercado: string;
    totalSignals: number;
    winCloseCount: number;
    winRateClosePct: number;
    totalPnlPoints: number;
  }>;
}

export interface H1MonthOption {
  key: string;
  label: string;
  totalSignals: number;
}

export interface H1WeekOption {
  key: string;
  label: string;
  monthKey: string;
  totalSignals: number;
}

export interface H1StatisticsResult {
  summary: {
    totalSignals: number;
    winCloseCount: number;
    winPeakCount: number;
    lossCloseCount: number;
    winRateClosePct: number;
    winRatePeakPct: number;
    totalPnlPoints: number;
    avgPnlPoints: number;
    bestSymbol: { symbol: string; mercado: string; winRateClosePct: number; totalSignals: number } | null;
    mostActiveSymbol: { symbol: string; mercado: string; totalSignals: number } | null;
  };
  bySymbol: H1SymbolStatistics[];
  byWeek: H1WeekStatistics[];
  availableMonths: H1MonthOption[];
  availableWeeks: H1WeekOption[];
  events: H1SignalEvent[];
  filterApplied: {
    month: string;
    week: string;
    symbol: string;
    tolerancePct: number;
  };
}

export interface H1RealIndexSummaryEvent {
  id: string;
  symbol: string;
  mercado: string;
  direction: 'BUY' | 'SELL';
  signalEpoch: number;
  signalTimeStr: string;
  firstCandlePnlPoints: number;
  firstCandleResult: 'PROFIT' | 'LOSS';
  secondCandlePnlPoints: number;
  secondCandleResult: 'PROFIT' | 'LOSS';
  secondCandlePhase: 'CONTINUACION' | 'REVERSA_DESPUES_DE_PROFIT' | 'REVERSA_DESPUES_DE_PERDIDA' | 'DOBLE_PROFIT' | 'DOBLE_PERDIDA' | 'MIXTO';
  note: string;
}

export interface H1RealIndexSummaryItem {
  symbol: string;
  mercado: string;
  marketType: 'CRASH' | 'BOOM';
  signalCount: number;
  firstCandleWinCount: number;
  firstCandleLossCount: number;
  firstCandleWinRatePct: number;
  firstCandleAvgPnlPoints: number;
  secondCandleWinCount: number;
  secondCandleLossCount: number;
  secondCandleWinRatePct: number;
  secondCandleAvgPnlPoints: number;
  continuationCount: number;
  continuationRatePct: number;
  reversalAfterProfitCount: number;
  reversalAfterLossCount: number;
  doubleProfitCount: number;
  doubleLossCount: number;
  mixedCount: number;
  totalPnlPoints: number;
  events: H1RealIndexSummaryEvent[];
}

function getWeekInfo(date: Date): { weekKey: string; weekLabel: string; monthKey: string; monthLabel: string } {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  const year = new Date(firstThursday).getFullYear();
  const weekKey = `${year}-W${String(weekNumber).padStart(2, '0')}`;

  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  const m = date.getMonth();
  const y = date.getFullYear();
  const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`;
  const monthLabel = `${monthNames[m]} ${y}`;

  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const formatDayMonth = (d: Date) => `${d.getDate()} ${monthNames[d.getMonth()].slice(0, 3)}`;
  const weekLabel = `Semana ${weekNumber} (${formatDayMonth(monday)} - ${formatDayMonth(sunday)})`;

  return { weekKey, weekLabel, monthKey, monthLabel };
}

function toMarketName(symbol: string): string {
  const up = (symbol ?? '').toUpperCase();
  if (up.startsWith('CRASH')) {
    const num = up.replace('CRASH', '').replace('N', '');
    return `Crash ${num}`;
  }
  if (up.startsWith('BOOM')) {
    const num = up.replace('BOOM', '').replace('N', '');
    return `Boom ${num}`;
  }
  return symbol;
}

function emaLast(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let value = values.slice(0, period).reduce((sum, current) => sum + current, 0) / period;
  for (let index = period; index < values.length; index += 1) {
    value = values[index] * multiplier + value * (1 - multiplier);
  }
  return value;
}

function getH4Trend(candles: { close: number; epoch: number }[]): 'ALCISTA' | 'BAJISTA' | 'NEUTRAL' {
  const closes = [...candles]
    .sort((a, b) => Number(a.epoch) - Number(b.epoch))
    .map((candle) => Number(candle.close))
    .filter(Number.isFinite);
  const ema9 = emaLast(closes, 9);
  const ema21 = emaLast(closes, 21);
  if (ema9 === null || ema21 === null) return 'NEUTRAL';
  if (ema9 > ema21) return 'ALCISTA';
  if (ema9 < ema21) return 'BAJISTA';
  return 'NEUTRAL';
}

function findHistoricalLevelReaction(
  candles: H1CandleAnalysis[],
  targetEpoch: number,
  level: number,
): H1HistoricalReaction {
  const history = candles.filter((candle) => !candle.isInProgress && candle.epoch < targetEpoch);
  const ranges = history
    .slice(-120)
    .map((candle) => candle.range)
    .filter((range) => Number.isFinite(range) && range > 0)
    .sort((a, b) => a - b);
  const typicalRange = ranges[Math.floor(ranges.length / 2)] || 0;
  const tolerancePoints = Math.max(typicalRange * 0.12, Math.abs(level) * 0.0001);
  const minimumReaction = Math.max(typicalRange * 1.5, tolerancePoints * 4);
  const reactions: Array<{
    epoch: number;
    direction: 'ALCISTA' | 'BAJISTA';
    movePoints: number;
  }> = [];

  for (let index = 0; index < history.length - 1; index += 1) {
    const candle = history[index];
    const bodyNearLevel = Math.min(
      Math.abs(candle.open - level),
      Math.abs(candle.close - level),
    ) <= tolerancePoints;
    if (!bodyNearLevel) continue;

    const nextCandles = history.slice(index + 1, index + 5);
    if (!nextCandles.length) continue;
    const upwardMove = Math.max(...nextCandles.map((next) => next.high)) - level;
    const downwardMove = level - Math.min(...nextCandles.map((next) => next.low));
    const movePoints = Math.max(upwardMove, downwardMove);
    if (movePoints < minimumReaction) continue;

    reactions.push({
      epoch: candle.epoch,
      direction: upwardMove >= downwardMove ? 'ALCISTA' : 'BAJISTA',
      movePoints,
    });
    index += 5;
  }

  const last = reactions[reactions.length - 1];
  return {
    found: reactions.length > 0,
    count: reactions.length,
    level: Number(level.toFixed(4)),
    tolerancePoints: Number(tolerancePoints.toFixed(4)),
    lastReactionAt: last ? new Date(last.epoch * 1000).toISOString() : null,
    lastDirection: last?.direction || null,
    lastMovePoints: Number((last?.movePoints || 0).toFixed(4)),
  };
}

@Injectable()
export class H1StrategyService {
  private readonly logger = new Logger(H1StrategyService.name);

  constructor(private readonly candlesService: CandlesService) {}

  async analyzeAllIndices(tolerancePct = 0.2): Promise<H1StrategySummary> {
    const now = new Date();
    const nowEpoch = Math.floor(now.getTime() / 1000);
    const currentHourBucket = Math.floor(nowEpoch / 3600) * 3600;

    // Próximo cambio de hora (:00)
    const nextHourDate = new Date((currentHourBucket + 3600) * 1000);
    const secondsToNextHour = Math.max(0, Math.floor((nextHourDate.getTime() - now.getTime()) / 1000));

    const indices: H1IndexResult[] = [];
    const activeAlerts: H1StrategySummary['activeAlerts'] = [];

    const results = await Promise.all(
      CRASH_BOOM_KNOWN_SYMBOLS.map(async (symbol) => {
        try {
          const [rawCandles, h4Candles] = await Promise.all([
            this.candlesService.findLatest(symbol, 3600, 240),
            this.candlesService.findLatest(symbol, 14400, 60),
          ]);
          const sorted = [...rawCandles].sort((a, b) => Number(a.epoch) - Number(b.epoch));
          const h4Trend = getH4Trend(h4Candles);

          const analyzedCandles: H1CandleAnalysis[] = sorted.map((c) => {
            const epoch = Number(c.epoch);
            const open = Number(c.open);
            const high = Number(c.high);
            const low = Number(c.low);
            const close = Number(c.close);

            const body = parseFloat(Math.abs(close - open).toFixed(4));
            const range = parseFloat(Math.max(high - low, 0.0001).toFixed(4));
            const isBullish = close >= open;

            const upperWick = parseFloat((isBullish ? high - close : high - open).toFixed(4));
            const lowerWick = parseFloat((isBullish ? open - low : close - low).toFixed(4));

            const tolDist = (range * tolerancePct) / 100;
            const noUpperWick = upperWick <= 0.0001 || upperWick <= tolDist;
            const noLowerWick = lowerWick <= 0.0001 || lowerWick <= tolDist;
            const isNoWickBoth = noUpperWick && noLowerWick;

            const candleCloseEpoch = epoch + 3600;
            const d = new Date(candleCloseEpoch * 1000);
            const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const hourStr = `${d.getHours()}:00`;

            const isInProgress = epoch >= currentHourBucket;

            return {
              epoch,
              timeStr,
              hourStr,
              open,
              high,
              low,
              close,
              body,
              range,
              upperWick,
              lowerWick,
              isBullish,
              isNoWickBoth,
              noUpperWick,
              noLowerWick,
              isInProgress,
            };
          });

          const last24 = analyzedCandles.slice(-25);
          const completedCandles = analyzedCandles.filter((c) => !c.isInProgress);
          const latestCompleted = completedCandles.length > 0 ? completedCandles[completedCandles.length - 1] : null;

          const recent24Completed = completedCandles.slice(-24);
          const noWickCount24h = recent24Completed.filter((c) => c.isNoWickBoth).length;

          const symUp = symbol.toUpperCase();
          const isBoomSym = symUp.includes('BOOM');
          const isCrashSym = symUp.includes('CRASH');
          const h4AgainstTrade =
            (isCrashSym && h4Trend === 'ALCISTA') ||
            (isBoomSym && h4Trend === 'BAJISTA');

          // Regla estricta H1 sin mecha: CERO mecha por encima Y CERO mecha por debajo (isNoWickBoth)
          // BOOM: Solo velas BAJISTAS sin mecha arriba ni abajo
          // CRASH: Solo velas ALCISTAS sin mecha arriba ni abajo
          const isSignalCandle = (c: H1CandleAnalysis | null | undefined) => {
            if (!c) return false;
            if (!c.isNoWickBoth) return false;
            if (isBoomSym && c.isBullish) return false;
            if (isCrashSym && !c.isBullish) return false;
            return true;
          };

          // ── CIERRE ANTICIPADO H1 (1-2 MINUTOS ANTES DE :00) ──
          // Si faltan 120 segundos (2 minutos) o menos para el cambio de hora,
          // evaluamos la vela en curso que ya lleva 58+ minutos formándose sin mechas.
          // Esto permite adelantarse al spike exacto que suele formarse en el minuto 59 o al segundo 00.
          const inProgressCandle = analyzedCandles.find((c) => c.isInProgress);
          const isAnticipatedWindow = secondsToNextHour <= 120 && secondsToNextHour > 0;
          const isAnticipatedAlert =
            isAnticipatedWindow &&
            !!inProgressCandle &&
            isSignalCandle(inProgressCandle) &&
            inProgressCandle.body >= 0.5;

          const latestCompletedCloseEpoch = latestCompleted ? latestCompleted.epoch + 3600 : 0;
          const hasFreshCompletedCandle = latestCompletedCloseEpoch === currentHourBucket;
          const hasCompletedAlert =
            hasFreshCompletedCandle &&
            !!latestCompleted &&
            isSignalCandle(latestCompleted);
          const hasActiveAlert = isAnticipatedAlert || hasCompletedAlert;

          const targetCandle = isAnticipatedAlert ? inProgressCandle! : latestCompleted;
          const isAnticipated = isAnticipatedAlert;

          const activeAlertReason = isAnticipatedAlert
            ? `Cierre ANTICIPADO H1 (a ${secondsToNextHour}s del cierre :00) sin mecha (cuerpo: ${inProgressCandle?.body} pts)`
            : hasCompletedAlert
            ? `Cierre H1 a las ${latestCompleted?.hourStr} sin mecha (cuerpo: ${latestCompleted?.body} pts)`
            : null;

          const mercado = toMarketName(symbol);

          let alertItem: H1StrategySummary['activeAlerts'][0] | null = null;
          if (hasActiveAlert && targetCandle) {
            const candleCloseEpoch = targetCandle.epoch + 3600;
            const closeDate = new Date(candleCloseEpoch * 1000);
            const hourLabel = `${closeDate.getHours()}:00`;
            const historicalReaction = findHistoricalLevelReaction(
              analyzedCandles,
              targetCandle.epoch,
              targetCandle.close,
            );
            const baseMessage = isAnticipated
              ? `¡ALERTA H1 ANTICIPADA (${secondsToNextHour}s antes de las ${hourLabel})! ${mercado} vela ${targetCandle.isBullish ? 'ALCISTA 🟢' : 'BAJISTA 🔴'} SIN MECHA.`
              : `¡ALERTA H1! ${mercado} cerró vela ${targetCandle.isBullish ? 'ALCISTA 🟢' : 'BAJISTA 🔴'} SIN MECHA a las ${targetCandle.hourStr || hourLabel}.`;
            const trendWarning = h4AgainstTrade
              ? ` Evaluar bien: la tendencia H4 ${h4Trend} esta en contra de la operacion.`
              : '';
            const reactionDate = historicalReaction.lastReactionAt
              ? new Intl.DateTimeFormat('es-CO', {
                  timeZone: 'America/Bogota',
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(historicalReaction.lastReactionAt))
              : '';
            const reactionCountText = historicalReaction.count === 1
              ? '1 vez'
              : `${historicalReaction.count} veces`;
            const reactionMessage = historicalReaction.found
              ? ` El indice ya reacciono ${reactionCountText} cerca de ${historicalReaction.level}; la ultima fue el ${reactionDate}, ${historicalReaction.lastDirection}, y recorrio ${historicalReaction.lastMovePoints} puntos.`
              : '';

            alertItem = {
              symbol,
              mercado,
              direction: targetCandle.isBullish ? 'ALCISTA' : 'BAJISTA',
              epoch: targetCandle.epoch,
              closedAt: closeDate.toISOString(),
              open: targetCandle.open,
              close: targetCandle.close,
              body: targetCandle.body,
              isAnticipated,
              secondsToClose: isAnticipated ? secondsToNextHour : 0,
              h4Trend,
              h4AgainstTrade,
              historicalReaction,
              message: `${baseMessage}${trendWarning}${reactionMessage}`,
            };
          }

          return {
            indexResult: {
              symbol,
              mercado,
              h4Trend,
              candles24h: last24,
              noWickCount24h,
              latestCompleted,
              hasActiveAlert,
              activeAlertReason,
              historicalReaction: alertItem?.historicalReaction || null,
            },
            alertItem,
          };
        } catch (err) {
          this.logger.warn(`Error analizando velas H1 para ${symbol}: ${err}`);
          return null;
        }
      }),
    );

    for (const r of results) {
      if (!r) continue;
      indices.push(r.indexResult);
      if (r.alertItem) {
        activeAlerts.push(r.alertItem);
      }
    }

    return {
      indices,
      activeAlerts,
      nextHourChangeAt: nextHourDate.toISOString(),
      secondsToNextHour,
      computedAt: now.toISOString(),
    };
  }

  /**
   * Genera estadísticas históricas detalladas para la Estrategia H1 (Velas Sin Mecha).
   * Evalúa por índice, semana y mes cuántas velas cerraron sin mecha y cuántas
   * dieron profit en la siguiente vela, calculando efectividad (%) y puntos obtenidos.
   */
  async getRealIndexSummary(filters?: {
    month?: string;
    week?: string;
    symbol?: string;
    tolerancePct?: number;
    monthsBack?: number;
  }): Promise<{ generatedAt: string; filterApplied: { month: string; week: string; symbol: string; tolerancePct: number; monthsBack?: number }; bySymbol: H1RealIndexSummaryItem[] }> {
    const tolerancePct = filters?.tolerancePct !== undefined ? Number(filters.tolerancePct) : 0.2;
    const filterMonth = filters?.month && filters.month !== 'ALL' ? filters.month : null;
    const filterWeek = filters?.week && filters.week !== 'ALL' ? filters.week : null;
    const filterSymbol = filters?.symbol && filters.symbol !== 'ALL' ? filters.symbol.toUpperCase() : null;
    const monthsBack = Number.isFinite(filters?.monthsBack) ? Math.max(1, Math.min(12, Number(filters?.monthsBack))) : null;

    const targetSymbols = filterSymbol
      ? CRASH_BOOM_KNOWN_SYMBOLS.filter((s) => s.toUpperCase() === filterSymbol)
      : CRASH_BOOM_KNOWN_SYMBOLS;

    const kindBySymbol = new Map<string, H1RealIndexSummaryItem>();

    for (const sym of targetSymbols) {
      try {
        const rawCandles = await this.candlesService.findLatest(sym, 3600, 2400);
        const sorted = [...rawCandles].sort((a, b) => Number(a.epoch) - Number(b.epoch));
        if (sorted.length < 3) continue;

        const isBoom = sym.toUpperCase().startsWith('BOOM');
        const marketType = isBoom ? 'BOOM' : 'CRASH';
        const mercado = toMarketName(sym);
        const events: H1RealIndexSummaryEvent[] = [];

        for (let i = 0; i < sorted.length - 2; i++) {
          const signalCandle = sorted[i];
          const nextCandle = sorted[i + 1];
          const secondCandle = sorted[i + 2];

          const diff1 = Number(nextCandle.epoch) - Number(signalCandle.epoch);
          const diff2 = Number(secondCandle.epoch) - Number(nextCandle.epoch);
          if (diff1 <= 0 || diff2 <= 0 || diff1 > 7200 || diff2 > 7200) continue;

          const open = Number(signalCandle.open);
          const close = Number(signalCandle.close);
          const high = Number(signalCandle.high);
          const low = Number(signalCandle.low);
          const range = parseFloat(Math.max(high - low, 0.0001).toFixed(4));
          const nextOpen = Number(nextCandle.open);
          const nextClose = Number(nextCandle.close);
          const nextHigh = Number(nextCandle.high);
          const nextLow = Number(nextCandle.low);
          const secondOpen = Number(secondCandle.open);
          const secondClose = Number(secondCandle.close);
          const secondHigh = Number(secondCandle.high);
          const secondLow = Number(secondCandle.low);

          const body = parseFloat(Math.abs(close - open).toFixed(4));
          const upperWick = parseFloat((close >= open ? high - close : high - open).toFixed(4));
          const lowerWick = parseFloat((close >= open ? open - low : close - low).toFixed(4));
          const tolDist = (range * tolerancePct) / 100;
          const noUpperWick = upperWick <= 0.0001 || upperWick <= tolDist;
          const noLowerWick = lowerWick <= 0.0001 || lowerWick <= tolDist;
          const isNoWickBoth = noUpperWick && noLowerWick;
          if (!isNoWickBoth) continue;

          if (isBoom && close >= open) continue;
          if (!isBoom && close < open) continue;

          const direction: 'BUY' | 'SELL' = isBoom ? 'BUY' : 'SELL';
          const firstCandlePnl = direction === 'BUY' ? nextClose - close : close - nextClose;
          const secondCandlePnl = direction === 'BUY' ? secondClose - nextClose : nextClose - secondClose;
          const firstCandleResult = firstCandlePnl > 0 ? 'PROFIT' : 'LOSS';
          const secondCandleResult = secondCandlePnl > 0 ? 'PROFIT' : 'LOSS';

          let secondCandlePhase: H1RealIndexSummaryEvent['secondCandlePhase'];
          if (firstCandleResult === 'PROFIT' && secondCandleResult === 'PROFIT') {
            secondCandlePhase = 'DOBLE_PROFIT';
          } else if (firstCandleResult === 'LOSS' && secondCandleResult === 'LOSS') {
            secondCandlePhase = 'DOBLE_PERDIDA';
          } else if (firstCandleResult === 'PROFIT' && secondCandleResult === 'LOSS') {
            secondCandlePhase = 'REVERSA_DESPUES_DE_PROFIT';
          } else if (firstCandleResult === 'LOSS' && secondCandleResult === 'PROFIT') {
            secondCandlePhase = 'REVERSA_DESPUES_DE_PERDIDA';
          } else if (firstCandleResult === 'PROFIT' && secondCandleResult === 'PROFIT') {
            secondCandlePhase = 'CONTINUACION';
          } else {
            secondCandlePhase = 'MIXTO';
          }

          if (firstCandleResult === 'PROFIT' && secondCandleResult === 'PROFIT') {
            secondCandlePhase = 'CONTINUACION';
          }

          const signalDate = new Date(Number(signalCandle.epoch) * 1000);
          const monthKey = `${signalDate.getFullYear()}-${String(signalDate.getMonth() + 1).padStart(2, '0')}`;
          const weekKey = getWeekInfo(signalDate).weekKey;

          if (filterMonth && monthKey !== filterMonth) continue;
          if (filterWeek && weekKey !== filterWeek) continue;
          if (monthsBack) {
            const cutoff = new Date();
            cutoff.setMonth(cutoff.getMonth() - monthsBack);
            cutoff.setDate(1);
            cutoff.setHours(0, 0, 0, 0);
            if (signalDate < cutoff) continue;
          }

          events.push({
            id: `${sym}_${signalCandle.epoch}`,
            symbol: sym,
            mercado,
            direction,
            signalEpoch: Number(signalCandle.epoch),
            signalTimeStr: signalDate.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
            firstCandlePnlPoints: parseFloat(firstCandlePnl.toFixed(3)),
            firstCandleResult,
            secondCandlePnlPoints: parseFloat(secondCandlePnl.toFixed(3)),
            secondCandleResult,
            secondCandlePhase,
            note: `Primera vela ${firstCandleResult} (${firstCandlePnl.toFixed(3)} pts) · segunda vela ${secondCandleResult} (${secondCandlePnl.toFixed(3)} pts)`,
          });
        }

        if (!events.length) continue;

        const firstCandleWins = events.filter((e) => e.firstCandleResult === 'PROFIT').length;
        const firstCandleLosses = events.filter((e) => e.firstCandleResult === 'LOSS').length;
        const secondCandleWins = events.filter((e) => e.secondCandleResult === 'PROFIT').length;
        const secondCandleLosses = events.filter((e) => e.secondCandleResult === 'LOSS').length;
        const continuationCount = events.filter((e) => e.secondCandlePhase === 'CONTINUACION').length;
        const reversalAfterProfitCount = events.filter((e) => e.secondCandlePhase === 'REVERSA_DESPUES_DE_PROFIT').length;
        const reversalAfterLossCount = events.filter((e) => e.secondCandlePhase === 'REVERSA_DESPUES_DE_PERDIDA').length;
        const doubleProfitCount = events.filter((e) => e.secondCandlePhase === 'DOBLE_PROFIT').length;
        const doubleLossCount = events.filter((e) => e.secondCandlePhase === 'DOBLE_PERDIDA').length;
        const mixedCount = events.filter((e) => e.secondCandlePhase === 'MIXTO').length;

        const totalPnl = events.reduce((sum, e) => sum + e.firstCandlePnlPoints, 0);

        const summary: H1RealIndexSummaryItem = {
          symbol: sym,
          mercado,
          marketType,
          signalCount: events.length,
          firstCandleWinCount: firstCandleWins,
          firstCandleLossCount: firstCandleLosses,
          firstCandleWinRatePct: events.length ? parseFloat(((firstCandleWins / events.length) * 100).toFixed(1)) : 0,
          firstCandleAvgPnlPoints: events.length ? parseFloat((events.reduce((sum, e) => sum + e.firstCandlePnlPoints, 0) / events.length).toFixed(2)) : 0,
          secondCandleWinCount: secondCandleWins,
          secondCandleLossCount: secondCandleLosses,
          secondCandleWinRatePct: events.length ? parseFloat(((secondCandleWins / events.length) * 100).toFixed(1)) : 0,
          secondCandleAvgPnlPoints: events.length ? parseFloat((events.reduce((sum, e) => sum + e.secondCandlePnlPoints, 0) / events.length).toFixed(2)) : 0,
          continuationCount,
          continuationRatePct: events.length ? parseFloat(((continuationCount / events.length) * 100).toFixed(1)) : 0,
          reversalAfterProfitCount,
          reversalAfterLossCount,
          doubleProfitCount,
          doubleLossCount,
          mixedCount,
          totalPnlPoints: parseFloat(totalPnl.toFixed(2)),
          events,
        };

        kindBySymbol.set(sym, summary);
      } catch (error) {
        this.logger.warn(`Error calculando resumen real H1 para ${sym}: ${error?.message || error}`);
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      filterApplied: {
        month: filterMonth || 'ALL',
        week: filterWeek || 'ALL',
        symbol: filterSymbol || 'ALL',
        tolerancePct,
        monthsBack: monthsBack ?? undefined,
      },
      bySymbol: Array.from(kindBySymbol.values()).sort((a, b) => b.signalCount - a.signalCount || b.firstCandleWinRatePct - a.firstCandleWinRatePct),
    };
  }

  async getH1Statistics(filters?: {
    month?: string;
    week?: string;
    symbol?: string;
    tolerancePct?: number;
  }): Promise<H1StatisticsResult> {
    const tolerancePct = filters?.tolerancePct !== undefined ? Number(filters.tolerancePct) : 0.2;
    const filterMonth = filters?.month && filters.month !== 'ALL' ? filters.month : null;
    const filterWeek = filters?.week && filters.week !== 'ALL' ? filters.week : null;
    const filterSymbol = filters?.symbol && filters.symbol !== 'ALL' ? filters.symbol.toUpperCase() : null;

    const targetSymbols = filterSymbol
      ? CRASH_BOOM_KNOWN_SYMBOLS.filter((s) => s.toUpperCase() === filterSymbol)
      : CRASH_BOOM_KNOWN_SYMBOLS;

    const allEvents: H1SignalEvent[] = [];

    // Recorrer los símbolos objetivos y extraer velas H1
    for (const sym of targetSymbols) {
      try {
        const rawCandles = await this.candlesService.findLatest(sym, 3600, 2000);
        const sorted = [...rawCandles].sort((a, b) => Number(a.epoch) - Number(b.epoch));
        if (sorted.length < 2) continue;

        const isBoom = sym.toUpperCase().startsWith('BOOM');
        const mercado = toMarketName(sym);

        for (let i = 0; i < sorted.length - 1; i++) {
          const c = sorted[i];
          const next = sorted[i + 1];

          // Validar horas consecutivas (máximo gap 2 horas)
          const diffEpoch = Number(next.epoch) - Number(c.epoch);
          if (diffEpoch <= 0 || diffEpoch > 7200) continue;

          const open = Number(c.open);
          const high = Number(c.high);
          const low = Number(c.low);
          const close = Number(c.close);
          const body = parseFloat(Math.abs(close - open).toFixed(4));
          const range = parseFloat(Math.max(high - low, 0.0001).toFixed(4));
          const isBullish = close >= open;

          const upperWick = parseFloat((isBullish ? high - close : high - open).toFixed(4));
          const lowerWick = parseFloat((isBullish ? open - low : close - low).toFixed(4));

          const tolDist = (range * tolerancePct) / 100;
          const noUpperWick = upperWick <= 0.0001 || upperWick <= tolDist;
          const noLowerWick = lowerWick <= 0.0001 || lowerWick <= tolDist;
          const isNoWickBoth = noUpperWick && noLowerWick;
          if (!isNoWickBoth) continue;

          // ── ESTRATEGIA DE REVERSAL POR TIPO DE ÍNDICE ─────────────────────
          // BOOM: esperamos spike alcista → SOLO velas BAJISTAS sin mecha → BUY
          // CRASH: esperamos spike bajista → SOLO velas ALCISTAS sin mecha → SELL
          // Velas que no coinciden con el tipo de índice se descartan.
          if (isBoom && isBullish) continue;   // BOOM solo acepta velas bajistas
          if (!isBoom && !isBullish) continue;  // CRASH solo acepta velas alcistas

          // La dirección es siempre el opuesto al color de la vela señal:
          // BOOM  + bajista → BUY  (se anticipa rebote alcista / spike UP)
          // CRASH + alcista → SELL (se anticipa caída / spike DOWN)
          const direction: 'BUY' | 'SELL' = isBoom ? 'BUY' : 'SELL';

          const nextOpen = Number(next.open);
          const nextHigh = Number(next.high);
          const nextLow = Number(next.low);
          const nextClose = Number(next.close);
          const nextBody = parseFloat(Math.abs(nextClose - nextOpen).toFixed(4));

          const entryPrice = close;
          const exitPrice = nextClose;

          let pnlClosePoints = 0;
          let maxProfitPoints = 0;
          let maxDrawdownPoints = 0;

          if (direction === 'BUY') {
            // BOOM: profit si la siguiente vela cierra MÁS ALTO que la entrada
            pnlClosePoints = nextClose - entryPrice;
            maxProfitPoints = Math.max(0, nextHigh - entryPrice);
            maxDrawdownPoints = Math.max(0, entryPrice - nextLow);
          } else {
            // CRASH: profit si la siguiente vela cierra MÁS BAJO que la entrada
            pnlClosePoints = entryPrice - nextClose;
            maxProfitPoints = Math.max(0, entryPrice - nextLow);
            maxDrawdownPoints = Math.max(0, nextHigh - entryPrice);
          }

          const isProfitClose = pnlClosePoints > 0;
          const isProfitPeak = maxProfitPoints > 0;
          const pnlPercent = entryPrice > 0 ? (pnlClosePoints / entryPrice) * 100 : 0;

          const d = new Date(Number(c.epoch) * 1000);
          const weekInfo = getWeekInfo(d);
          const signalTimeStr = d.toLocaleDateString([], {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });
          const nextDate = new Date(Number(next.epoch) * 1000);
          const nextTimeStr = nextDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          allEvents.push({
            id: `${sym}_${c.epoch}`,
            symbol: sym,
            mercado,
            marketType: isBoom ? 'BOOM' : 'CRASH',
            direction,
            signalEpoch: Number(c.epoch),
            signalTimeStr,
            monthKey: weekInfo.monthKey,
            monthLabel: weekInfo.monthLabel,
            weekKey: weekInfo.weekKey,
            weekLabel: weekInfo.weekLabel,
            signalCandle: {
              open,
              high,
              low,
              close,
              body,
              range,
              upperWick,
              lowerWick,
            },
            nextCandle: {
              epoch: Number(next.epoch),
              timeStr: nextTimeStr,
              open: nextOpen,
              high: nextHigh,
              low: nextLow,
              close: nextClose,
              body: nextBody,
            },
            entryPrice: parseFloat(entryPrice.toFixed(3)),
            exitPrice: parseFloat(exitPrice.toFixed(3)),
            pnlClosePoints: parseFloat(pnlClosePoints.toFixed(3)),
            maxProfitPoints: parseFloat(maxProfitPoints.toFixed(3)),
            maxDrawdownPoints: parseFloat(maxDrawdownPoints.toFixed(3)),
            pnlPercent: parseFloat(pnlPercent.toFixed(2)),
            isProfitClose,
            isProfitPeak,
          });
        }
      } catch (e) {
        this.logger.warn(`Error procesando estadísticas H1 para ${sym}: ${e?.message}`);
      }
    }

    // 1. Extraer opciones de meses y semanas disponibles
    const monthsMap = new Map<string, { label: string; count: number }>();
    const weeksMap = new Map<string, { label: string; monthKey: string; count: number }>();

    for (const ev of allEvents) {
      const curM = monthsMap.get(ev.monthKey) || { label: ev.monthLabel, count: 0 };
      curM.count++;
      monthsMap.set(ev.monthKey, curM);

      const curW = weeksMap.get(ev.weekKey) || {
        label: ev.weekLabel,
        monthKey: ev.monthKey,
        count: 0,
      };
      curW.count++;
      weeksMap.set(ev.weekKey, curW);
    }

    const availableMonths: H1MonthOption[] = Array.from(monthsMap.entries())
      .map(([key, val]) => ({ key, label: `${val.label} (${val.count} señales)`, totalSignals: val.count }))
      .sort((a, b) => b.key.localeCompare(a.key));

    const availableWeeks: H1WeekOption[] = Array.from(weeksMap.entries())
      .map(([key, val]) => ({
        key,
        label: `${val.label} (${val.count} señales)`,
        monthKey: val.monthKey,
        totalSignals: val.count,
      }))
      .sort((a, b) => b.key.localeCompare(a.key));

    // 2. Filtrar eventos según parámetros
    let filteredEvents = allEvents;
    if (filterMonth) {
      filteredEvents = filteredEvents.filter((ev) => ev.monthKey === filterMonth);
    }
    if (filterWeek) {
      filteredEvents = filteredEvents.filter((ev) => ev.weekKey === filterWeek);
    }
    filteredEvents.sort((a, b) => b.signalEpoch - a.signalEpoch);

    // 3. Totales globales
    const totalSignals = filteredEvents.length;
    const winCloseCount = filteredEvents.filter((ev) => ev.isProfitClose).length;
    const winPeakCount = filteredEvents.filter((ev) => ev.isProfitPeak).length;
    const lossCloseCount = totalSignals - winCloseCount;
    const winRateClosePct = totalSignals > 0 ? parseFloat(((winCloseCount / totalSignals) * 100).toFixed(1)) : 0;
    const winRatePeakPct = totalSignals > 0 ? parseFloat(((winPeakCount / totalSignals) * 100).toFixed(1)) : 0;
    const totalPnlPoints = parseFloat(filteredEvents.reduce((acc, ev) => acc + ev.pnlClosePoints, 0).toFixed(2));
    const avgPnlPoints = totalSignals > 0 ? parseFloat((totalPnlPoints / totalSignals).toFixed(2)) : 0;

    // 4. Estadísticas por Símbolo
    const symbolStatsMap = new Map<string, {
      mercado: string;
      marketType: 'CRASH' | 'BOOM';
      total: number;
      winClose: number;
      winPeak: number;
      totalPnl: number;
      bestWin: number;
      worstLoss: number;
    }>();

    for (const ev of filteredEvents) {
      const cur = symbolStatsMap.get(ev.symbol) || {
        mercado: ev.mercado,
        marketType: ev.marketType,
        total: 0,
        winClose: 0,
        winPeak: 0,
        totalPnl: 0,
        bestWin: 0,
        worstLoss: 0,
      };
      cur.total++;
      if (ev.isProfitClose) cur.winClose++;
      if (ev.isProfitPeak) cur.winPeak++;
      cur.totalPnl += ev.pnlClosePoints;
      if (ev.pnlClosePoints > cur.bestWin) cur.bestWin = ev.pnlClosePoints;
      if (ev.pnlClosePoints < cur.worstLoss) cur.worstLoss = ev.pnlClosePoints;
      symbolStatsMap.set(ev.symbol, cur);
    }

    const bySymbol: H1SymbolStatistics[] = Array.from(symbolStatsMap.entries()).map(([sym, stats]) => {
      const winRateClose = stats.total > 0 ? parseFloat(((stats.winClose / stats.total) * 100).toFixed(1)) : 0;
      const winRatePeak = stats.total > 0 ? parseFloat(((stats.winPeak / stats.total) * 100).toFixed(1)) : 0;
      const avgPnl = stats.total > 0 ? parseFloat((stats.totalPnl / stats.total).toFixed(2)) : 0;

      return {
        symbol: sym,
        mercado: stats.mercado,
        marketType: stats.marketType,
        totalSignals: stats.total,
        winCloseCount: stats.winClose,
        winPeakCount: stats.winPeak,
        lossCloseCount: stats.total - stats.winClose,
        winRateClosePct: winRateClose,
        winRatePeakPct: winRatePeak,
        totalPnlPoints: parseFloat(stats.totalPnl.toFixed(2)),
        avgPnlPoints: avgPnl,
        bestWinPoints: parseFloat(stats.bestWin.toFixed(2)),
        worstLossPoints: parseFloat(stats.worstLoss.toFixed(2)),
      };
    }).sort((a, b) => b.winRateClosePct - a.winRateClosePct || b.totalSignals - a.totalSignals);

    // 5. Estadísticas por Semana
    const weekStatsMap = new Map<string, {
      weekLabel: string;
      monthKey: string;
      total: number;
      winClose: number;
      winPeak: number;
      totalPnl: number;
      symbolMap: Map<string, { total: number; winClose: number; totalPnl: number; mercado: string }>;
    }>();

    for (const ev of filteredEvents) {
      const cur = weekStatsMap.get(ev.weekKey) || {
        weekLabel: ev.weekLabel,
        monthKey: ev.monthKey,
        total: 0,
        winClose: 0,
        winPeak: 0,
        totalPnl: 0,
        symbolMap: new Map(),
      };
      cur.total++;
      if (ev.isProfitClose) cur.winClose++;
      if (ev.isProfitPeak) cur.winPeak++;
      cur.totalPnl += ev.pnlClosePoints;

      const symCur = cur.symbolMap.get(ev.symbol) || { total: 0, winClose: 0, totalPnl: 0, mercado: ev.mercado };
      symCur.total++;
      if (ev.isProfitClose) symCur.winClose++;
      symCur.totalPnl += ev.pnlClosePoints;
      cur.symbolMap.set(ev.symbol, symCur);

      weekStatsMap.set(ev.weekKey, cur);
    }

    const byWeek: H1WeekStatistics[] = Array.from(weekStatsMap.entries()).map(([wKey, stats]) => {
      const winRateClose = stats.total > 0 ? parseFloat(((stats.winClose / stats.total) * 100).toFixed(1)) : 0;
      const winRatePeak = stats.total > 0 ? parseFloat(((stats.winPeak / stats.total) * 100).toFixed(1)) : 0;
      const bySymbolList = Array.from(stats.symbolMap.entries()).map(([sKey, sStats]) => ({
        symbol: sKey,
        mercado: sStats.mercado,
        totalSignals: sStats.total,
        winCloseCount: sStats.winClose,
        winRateClosePct: sStats.total > 0 ? parseFloat(((sStats.winClose / sStats.total) * 100).toFixed(1)) : 0,
        totalPnlPoints: parseFloat(sStats.totalPnl.toFixed(2)),
      })).sort((a, b) => b.winRateClosePct - a.winRateClosePct);

      return {
        weekKey: wKey,
        weekLabel: stats.weekLabel,
        monthKey: stats.monthKey,
        totalSignals: stats.total,
        winCloseCount: stats.winClose,
        winPeakCount: stats.winPeak,
        winRateClosePct: winRateClose,
        winRatePeakPct: winRatePeak,
        totalPnlPoints: parseFloat(stats.totalPnl.toFixed(2)),
        bySymbol: bySymbolList,
      };
    }).sort((a, b) => b.weekKey.localeCompare(a.weekKey));

    const bestSymbol = bySymbol.length > 0 ? {
      symbol: bySymbol[0].symbol,
      mercado: bySymbol[0].mercado,
      winRateClosePct: bySymbol[0].winRateClosePct,
      totalSignals: bySymbol[0].totalSignals,
    } : null;

    const mostActive = [...bySymbol].sort((a, b) => b.totalSignals - a.totalSignals);
    const mostActiveSymbol = mostActive.length > 0 ? {
      symbol: mostActive[0].symbol,
      mercado: mostActive[0].mercado,
      totalSignals: mostActive[0].totalSignals,
    } : null;

    return {
      summary: {
        totalSignals,
        winCloseCount,
        winPeakCount,
        lossCloseCount,
        winRateClosePct,
        winRatePeakPct,
        totalPnlPoints,
        avgPnlPoints,
        bestSymbol,
        mostActiveSymbol,
      },
      bySymbol,
      byWeek,
      availableMonths,
      availableWeeks,
      events: filteredEvents.slice(0, 300),
      filterApplied: {
        month: filterMonth || 'ALL',
        week: filterWeek || 'ALL',
        symbol: filterSymbol || 'ALL',
        tolerancePct,
      },
    };
  }
}
