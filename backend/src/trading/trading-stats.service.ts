import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { TradeRecord } from './trade.entity';

export interface SessionStats {
  session: 'MADRUGADA' | 'MANANA' | 'TARDE' | 'NOCHE';
  label: string;
  total: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netProfit: number;
}

export interface SymbolDailyStats {
  symbol: string;
  total: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netProfit: number;
  consecutiveLosses: number;
  circuitBreakerActive: boolean;
  circuitBreakerUntil: number | null;
}

export interface HourlyStats {
  hour: number;
  label: string;
  total: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netProfit: number;
}

@Injectable()
export class TradingStatsService {
  private readonly logger = new Logger(TradingStatsService.name);

  // ── Configuración de Retroalimentación Adaptativa ──
  private adaptiveEnabled = true;
  private minWinRateThreshold = 40.0; // WinRate mínimo aceptable en una hora para permitir trades (%)
  private minSamplesForHourFilter = 3;  // Muestra mínima de trades en una hora para aplicar filtro
  private maxConsecutiveLosses = 2;     // 2 pérdidas seguidas activan pausa preventiva
  private circuitBreakerCooldownMs = 90 * 60 * 1000; // 90 minutos de pausa preventiva tras 2 SL seguidos

  constructor(
    @InjectRepository(TradeRecord)
    private readonly tradeRepo: Repository<TradeRecord>,
  ) {}

  // ════════════════════════════════════════════════════════════════════════════
  // ── 1. GENERACIÓN DE INFORME DIARIO DE OPERACIONES ─────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Genera el informe diario o de rango de fechas con conteo de buenas, malas, beneficio y desgloses.
   * @param dateStr Fecha inicio 'YYYY-MM-DD' (o fecha única)
   * @param endDateStr Fecha fin opcional 'YYYY-MM-DD' para evaluar múltiples días
   */
  async getDailyReport(dateStr?: string, endDateStr?: string) {
    let startDate = new Date();
    let endDate = new Date();

    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-').map(Number);
      startDate = new Date(y, m - 1, d);
      endDate = new Date(y, m - 1, d);
    }

    if (endDateStr && /^\d{4}-\d{2}-\d{2}$/.test(endDateStr)) {
      const [y, m, d] = endDateStr.split('-').map(Number);
      endDate = new Date(y, m - 1, d);
    }

    const startOfDay = new Date(startDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);

    const startEpochSec = Math.floor(startOfDay.getTime() / 1000);
    const endEpochSec = Math.floor(endOfDay.getTime() / 1000);

    const trades = await this.tradeRepo.find({
      where: {
        entryTime: Between(startEpochSec, endEpochSec),
      },
      order: { entryTime: 'DESC' },
    });

    const getTradePnl = (t: TradeRecord) => {
      if (t.exitReason === 'MT5_TIMEOUT_NO_FILL') return 0;
      return Number(
        (t.pnlUsd !== undefined && t.pnlUsd !== null
          ? t.pnlUsd
          : (t.pnlPoints || 0) * (t.lot || 0.5)
        ).toFixed(2),
      );
    };

    const closedTrades = trades.filter(
      (t) => t.status === 'CLOSED' && t.exitReason !== 'MT5_TIMEOUT_NO_FILL',
    );
    const openTrades = trades.filter((t) => t.status === 'OPEN');

    let wins = 0;
    let losses = 0;
    let breakevens = 0;
    let totalGain = 0;
    let totalLoss = 0;
    let netProfit = 0;
    let totalDurationSec = 0;
    let durationCount = 0;

    for (const t of closedTrades) {
      const pnl = getTradePnl(t);
      netProfit += pnl;

      if (pnl > 0.05) {
        wins++;
        totalGain += pnl;
      } else if (pnl < -0.05) {
        losses++;
        totalLoss += Math.abs(pnl);
      } else {
        breakevens++;
      }

      if (t.durationSec && t.durationSec > 0) {
        totalDurationSec += t.durationSec;
        durationCount++;
      }
    }

    const totalClosed = closedTrades.length;
    const winRatePct =
      totalClosed > 0 ? Number(((wins / totalClosed) * 100).toFixed(1)) : 0;
    const profitFactor =
      totalLoss > 0
        ? Number((totalGain / totalLoss).toFixed(2))
        : totalGain > 0
        ? 99.99
        : 0;
    const avgDurationMin =
      durationCount > 0
        ? Number((totalDurationSec / durationCount / 60).toFixed(1))
        : 0;

    // Desglose por Índice
    const symbolsMap = new Map<string, TradeRecord[]>();
    for (const t of closedTrades) {
      const list = symbolsMap.get(t.symbol) || [];
      list.push(t);
      symbolsMap.set(t.symbol, list);
    }

    const bySymbol: SymbolDailyStats[] = [];
    for (const [sym, list] of symbolsMap.entries()) {
      let sWins = 0;
      let sLosses = 0;
      let sNet = 0;
      for (const t of list) {
        const p = getTradePnl(t);
        sNet += p;
        if (p > 0.05) sWins++;
        else if (p < -0.05) sLosses++;
      }
      const sRate = list.length > 0 ? Number(((sWins / list.length) * 100).toFixed(1)) : 0;
      const cbInfo = await this.checkSymbolCircuitBreaker(sym);

      bySymbol.push({
        symbol: sym,
        total: list.length,
        wins: sWins,
        losses: sLosses,
        winRatePct: sRate,
        netProfit: Number(sNet.toFixed(2)),
        consecutiveLosses: cbInfo.consecutiveLosses,
        circuitBreakerActive: cbInfo.active,
        circuitBreakerUntil: cbInfo.until,
      });
    }

    // Desglose por Franja Horaria (Sesiones)
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

    const bySession: SessionStats[] = sessionsOrder.map((s) => {
      const list = closedTrades.filter((t) => (t.session || this.getSessionFromHour(t.hourOfDay)) === s);
      let sWins = 0;
      let sLosses = 0;
      let sNet = 0;
      for (const t of list) {
        const p = getTradePnl(t);
        sNet += p;
        if (p > 0.05) sWins++;
        else if (p < -0.05) sLosses++;
      }
      return {
        session: s,
        label: sessionLabels[s],
        total: list.length,
        wins: sWins,
        losses: sLosses,
        winRatePct: list.length > 0 ? Number(((sWins / list.length) * 100).toFixed(1)) : 0,
        netProfit: Number(sNet.toFixed(2)),
      };
    });

    // Desglose por Hora (0 a 23)
    const byHour: HourlyStats[] = [];
    for (let h = 0; h < 24; h++) {
      const list = closedTrades.filter((t) => {
        if (t.hourOfDay !== null && t.hourOfDay !== undefined) return t.hourOfDay === h;
        const dt = new Date(Number(t.entryTime) * 1000);
        return dt.getHours() === h;
      });
      let hWins = 0;
      let hLosses = 0;
      let hNet = 0;
      for (const t of list) {
        const p = getTradePnl(t);
        hNet += p;
        if (p > 0.05) hWins++;
        else if (p < -0.05) hLosses++;
      }
      byHour.push({
        hour: h,
        label: `${String(h).padStart(2, '0')}:00`,
        total: list.length,
        wins: hWins,
        losses: hLosses,
        winRatePct: list.length > 0 ? Number(((hWins / list.length) * 100).toFixed(1)) : 0,
        netProfit: Number(hNet.toFixed(2)),
      });
    }

    // ── DESGLOSE COMPLETO POR ESTRATEGIA Y POR ÍNDICE (CON EVALUACIÓN DE BUENAS / MALAS) ──
    const strategyMetadata: Record<string, { label: string; icon: string; color: string }> = {
      DOUBLE_WICK_MECHA: {
        label: 'Dos Velas con Mecha (M5)',
        icon: 'timeline',
        color: 'teal-7',
      },
      CRASH_BOOM_IA: {
        label: 'Crash & Boom IA (Zonas V, 50% y OB)',
        icon: 'insights',
        color: 'purple-7',
      },
      M5_X: {
        label: 'M5X (Vela verde chata)',
        icon: 'compress',
        color: 'deep-orange-8',
      },
      H1_NO_WICK: {
        label: 'Estrategia H1 Sin Mecha',
        icon: 'candlestick_chart',
        color: 'indigo-7',
      },
      MANUAL_APP: {
        label: 'Operaciones Manuales (App)',
        icon: 'pan_tool',
        color: 'slate-5',
      },
      WATCHED_LEVEL: {
        label: 'Puntos Vigilados (Real)',
        icon: 'gps_fixed',
        color: 'emerald-7',
      },
      WATCHED_LEVEL_BT: {
        label: 'Puntos Vigilados (Backtesting)',
        icon: 'history_edu',
        color: 'amber-8',
      },
    };

    const strategiesMap = new Map<string, Map<string, TradeRecord[]>>();
    for (const t of closedTrades) {
      const stratKey = t.strategy || 'OTRA';
      if (!strategiesMap.has(stratKey)) {
        strategiesMap.set(stratKey, new Map<string, TradeRecord[]>());
      }
      const symMap = strategiesMap.get(stratKey)!;
      const symKey = t.symbol || 'DESCONOCIDO';
      if (!symMap.has(symKey)) {
        symMap.set(symKey, []);
      }
      symMap.get(symKey)!.push(t);
    }

    // Asegurar que las estrategias principales aparezcan incluso si tienen 0 trades en el periodo
    for (const key of ['DOUBLE_WICK_MECHA', 'CRASH_BOOM_IA', 'H1_NO_WICK', 'M5_X']) {
      if (!strategiesMap.has(key)) {
        strategiesMap.set(key, new Map<string, TradeRecord[]>());
      }
    }

    const byStrategy: any[] = [];

    for (const [strat, symMap] of strategiesMap.entries()) {
      const meta = strategyMetadata[strat] || {
        label: strat,
        icon: 'bolt',
        color: 'amber-7',
      };

      let stratWins = 0;
      let stratLosses = 0;
      let stratBreakevens = 0;
      let stratSpikes = 0;
      let stratNet = 0;
      let stratTotal = 0;
      const symbolsList: any[] = [];

      for (const [sym, list] of symMap.entries()) {
        let sWins = 0;
        let sLosses = 0;
        let sBe = 0;
        let sSpikes = 0;
        let sNet = 0;

        const tradeItems = list.map((t) => {
          const p = getTradePnl(t);
          sNet += p;
          let res: 'WIN' | 'LOSS' | 'BREAKEVEN' = 'BREAKEVEN';
          if (p > 0.05) {
            sWins++;
            res = 'WIN';
          } else if (p < -0.05) {
            sLosses++;
            res = 'LOSS';
          } else {
            sBe++;
            res = 'BREAKEVEN';
          }

          if (t.hadSpike) {
            sSpikes++;
          }

          const entryDate = new Date(Number(t.entryTime) * 1000);
          const dateFormatted =
            entryDate.toLocaleDateString('es-ES', {
              day: '2-digit',
              month: '2-digit',
            }) +
            ' ' +
            entryDate.toLocaleTimeString('es-ES', {
              hour: '2-digit',
              minute: '2-digit',
            });

          return {
            id: t.id,
            symbol: t.symbol,
            mercado: t.mercado || t.symbol,
            direction: t.direction,
            strategy: t.strategy,
            backtesting: Boolean(t.backtesting),
            hadSpike: Boolean(t.hadSpike),
            spikeCount: t.spikeCount || 0,
            maxProfitPoints: t.maxProfitPoints || 0,
            maxProfitUsd: t.maxProfitUsd || 0,
            entryTime: Number(t.entryTime),
            entryDateStr: dateFormatted,
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice,
            exitTime: t.exitTime ? Number(t.exitTime) : null,
            exitReason: t.exitReason,
            pnlUsd: p,
            pnlPoints: t.pnlPoints,
            result: res,
            durationMin: t.durationSec ? Math.round(t.durationSec / 60) : 0,
          };
        });

        const sTotal = list.length;
        stratWins += sWins;
        stratLosses += sLosses;
        stratBreakevens += sBe;
        stratSpikes += sSpikes;
        stratNet += sNet;
        stratTotal += sTotal;

        const winRate = sTotal > 0 ? Number(((sWins / sTotal) * 100).toFixed(1)) : 0;
        const spikeRate = sTotal > 0 ? Number(((sSpikes / sTotal) * 100).toFixed(1)) : 0;

        symbolsList.push({
          symbol: sym,
          mercado: list[0]?.mercado || sym,
          total: sTotal,
          wins: sWins,
          losses: sLosses,
          breakevens: sBe,
          winRatePct: winRate,
          spikes: sSpikes,
          spikeRatePct: spikeRate,
          netProfit: Number(sNet.toFixed(2)),
          trades: tradeItems,
        });
      }

      // Ordenar símbolos por mayor cantidad de trades
      symbolsList.sort((a, b) => b.total - a.total);

      const stratWinRate = stratTotal > 0 ? Number(((stratWins / stratTotal) * 100).toFixed(1)) : 0;
      const stratSpikeRate = stratTotal > 0 ? Number(((stratSpikes / stratTotal) * 100).toFixed(1)) : 0;

      byStrategy.push({
        strategy: strat,
        label: meta.label,
        icon: meta.icon,
        color: meta.color,
        total: stratTotal,
        wins: stratWins,
        losses: stratLosses,
        breakevens: stratBreakevens,
        winRatePct: stratWinRate,
        spikes: stratSpikes,
        spikeRatePct: stratSpikeRate,
        netProfit: Number(stratNet.toFixed(2)),
        symbols: symbolsList,
      });
    }

    // Ordenar estrategias poniendo primero las que tienen trades, luego por orden preferente
    byStrategy.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.label.localeCompare(b.label);
    });


    return {
      date: startOfDay.toISOString().slice(0, 10),
      startDate: startOfDay.toISOString().slice(0, 10),
      endDate: endOfDay.toISOString().slice(0, 10),
      isRange: startOfDay.toISOString().slice(0, 10) !== endOfDay.toISOString().slice(0, 10),
      summary: {
        totalTrades: trades.length,
        openTrades: openTrades.length,
        closedTrades: totalClosed,
        wins,
        losses,
        breakevens,
        winRatePct,
        netProfit: Number(netProfit.toFixed(2)),
        totalGain: Number(totalGain.toFixed(2)),
        totalLoss: Number(totalLoss.toFixed(2)),
        profitFactor,
        avgDurationMin,
      },
      bySession,
      bySymbol: bySymbol.sort((a, b) => b.netProfit - a.netProfit),
      byHour,
      byStrategy,
      trades: trades.slice(0, 100).map((t) => ({
        id: t.id,
        symbol: t.symbol,
        strategy: t.strategy,
        direction: t.direction,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        pnl: getTradePnl(t),
        pnlPercent: t.exitReason === 'MT5_TIMEOUT_NO_FILL' ? 0 : t.pnlPercent,
        status: t.status,
        result:
          t.exitReason === 'MT5_TIMEOUT_NO_FILL'
            ? 'BREAKEVEN'
            : t.result ||
              (getTradePnl(t) > 0.05
                ? 'WIN'
                : getTradePnl(t) < -0.05
                ? 'LOSS'
                : 'BREAKEVEN'),
        durationMin: t.durationSec ? Number((t.durationSec / 60).toFixed(1)) : 0,
        entryTimeFormatted: new Date(Number(t.entryTime) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        exitTimeFormatted: t.exitTime ? new Date(Number(t.exitTime) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—',
        exitReason: t.exitReason || '—',
        session: t.session || this.getSessionFromHour(t.hourOfDay),
      })),
      adaptiveStatus: await this.getAdaptiveStatus(),
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── 2. MOTOR DE RETROALIMENTACIÓN ADAPTATIVA (IA AUTO-FEEDBACK) ───────────
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Evalúa si una entrada es viable según las estadísticas históricas y la retroalimentación.
   * Si el índice está en racha perdedora (circuit breaker) o la hora tiene winrate bajo,
   * bloquea la entrada para proteger el capital.
   */
  async canTradeAdaptive(symbol: string, strategy: string): Promise<{ allowed: boolean; reason?: string }> {
    // Las estrategias H1_NO_WICK y DOUBLE_WICK_MECHA operan INMEDIATAMENTE sin bloqueos por filtros de sesión/hora
    if (!this.adaptiveEnabled || strategy === 'H1_NO_WICK' || strategy === 'DOUBLE_WICK_MECHA') {
      return { allowed: true };
    }

    const currentHour = new Date().getHours();
    const symUp = (symbol || '').toUpperCase();

    // 1. Verificar Circuit Breaker por rachas perdedoras en este símbolo
    const cb = await this.checkSymbolCircuitBreaker(symUp);
    if (cb.active) {
      const minutesLeft = Math.ceil(((cb.until || Date.now()) - Date.now()) / 60000);
      const msg = `⛔ [CIRCUIT BREAKER ACTIVO] ${symUp} lleva ${cb.consecutiveLosses} pérdidas seguidas. Pausa preventiva de protección por ${minutesLeft} min más.`;
      this.logger.warn(msg);
      return { allowed: false, reason: msg };
    }

    // 2. Verificar desempeño por Franja Horaria aprendida para este símbolo
    const hourPerf = await this.getHistoricalHourPerformance(symUp, currentHour);
    if (hourPerf.total >= this.minSamplesForHourFilter && hourPerf.winRatePct < this.minWinRateThreshold) {
      const msg = `⛔ [FILTRO HORARIO ADAPTATIVO] ${symUp}: La hora ${currentHour}:00 tiene bajo acierto histórico (${hourPerf.winRatePct.toFixed(0)}% en ${hourPerf.total} operaciones). Evitando entrada en ciclo desfavorable.`;
      this.logger.warn(msg);
      return { allowed: false, reason: msg };
    }

    // 3. Verificar desempeño por Sesión completa si hay suficiente historial
    const currentSession = this.getSessionFromHour(currentHour);
    const sessionPerf = await this.getHistoricalSessionPerformance(symUp, currentSession);
    if (sessionPerf.total >= 5 && sessionPerf.winRatePct < 30.0) {
      const msg = `⛔ [FILTRO SESIÓN ADAPTATIVO] ${symUp}: La sesión ${currentSession} tiene winrate crítico (${sessionPerf.winRatePct.toFixed(0)}%). Bloqueando nuevas entradas en esta sesión.`;
      this.logger.warn(msg);
      return { allowed: false, reason: msg };
    }

    return { allowed: true };
  }

  /**
   * Consulta el estado del Circuit Breaker (racha perdedora) de un símbolo.
   */
  private async checkSymbolCircuitBreaker(symbol: string): Promise<{
    active: boolean;
    consecutiveLosses: number;
    until: number | null;
  }> {
    const recentTrades = await this.tradeRepo.find({
      where: {
        symbol,
        status: 'CLOSED',
      },
      order: { exitTime: 'DESC' },
      take: 5,
    });

    let consecutiveLosses = 0;
    let lastLossTimeMs = 0;

    for (const t of recentTrades) {
      const pnl = Number(t.pnlUsd || t.pnlPoints || 0);
      if (pnl < -0.05) {
        consecutiveLosses++;
        if (lastLossTimeMs === 0 && t.exitTime) {
          lastLossTimeMs = Number(t.exitTime) * 1000;
        }
      } else {
        break; // Racha rota por una victoria o breakeven
      }
    }

    if (consecutiveLosses >= this.maxConsecutiveLosses && lastLossTimeMs > 0) {
      const cooldownEnd = lastLossTimeMs + this.circuitBreakerCooldownMs;
      if (Date.now() < cooldownEnd) {
        return {
          active: true,
          consecutiveLosses,
          until: cooldownEnd,
        };
      }
    }

    return {
      active: false,
      consecutiveLosses,
      until: null,
    };
  }

  /**
   * Obtiene estadísticas históricas de un símbolo en una hora dada (0 a 23).
   */
  private async getHistoricalHourPerformance(symbol: string, hour: number) {
    const trades = await this.tradeRepo.find({
      where: {
        symbol,
        hourOfDay: hour,
        status: 'CLOSED',
      },
      take: 50,
    });

    let wins = 0;
    let losses = 0;
    for (const t of trades) {
      const pnl = Number(t.pnlUsd || t.pnlPoints || 0);
      if (pnl > 0.05) wins++;
      else if (pnl < -0.05) losses++;
    }

    const total = trades.length;
    const winRatePct = total > 0 ? (wins / total) * 100 : 0;
    return { total, wins, losses, winRatePct };
  }

  /**
   * Obtiene estadísticas de un símbolo en una sesión determinada.
   */
  private async getHistoricalSessionPerformance(
    symbol: string,
    session: 'MADRUGADA' | 'MANANA' | 'TARDE' | 'NOCHE',
  ) {
    const trades = await this.tradeRepo.find({
      where: {
        symbol,
        session,
        status: 'CLOSED',
      },
      take: 50,
    });

    let wins = 0;
    let losses = 0;
    for (const t of trades) {
      const pnl = Number(t.pnlUsd || t.pnlPoints || 0);
      if (pnl > 0.05) wins++;
      else if (pnl < -0.05) losses++;
    }

    const total = trades.length;
    const winRatePct = total > 0 ? (wins / total) * 100 : 0;
    return { total, wins, losses, winRatePct };
  }

  /**
   * Diagnóstico del motor de retroalimentación para la interfaz.
   */
  async getAdaptiveStatus() {
    const activeSymbols = [
      'CRASH300N',
      'CRASH500',
      'CRASH600',
      'CRASH900',
      'CRASH1000',
      'BOOM300N',
      'BOOM500',
      'BOOM600',
      'BOOM900',
      'BOOM1000',
    ];

    const currentHour = new Date().getHours();
    const currentSession = this.getSessionFromHour(currentHour);

    const symbolsStatus = await Promise.all(
      activeSymbols.map(async (sym) => {
        const cb = await this.checkSymbolCircuitBreaker(sym);
        const hourPerf = await this.getHistoricalHourPerformance(sym, currentHour);
        const sessionPerf = await this.getHistoricalSessionPerformance(sym, currentSession);

        let status: 'APROBADO' | 'PAUSA_CIRCUIT_BREAKER' | 'HORA_DESFAVORABLE' = 'APROBADO';
        let statusMessage = 'Óptimo para operar';

        if (cb.active) {
          status = 'PAUSA_CIRCUIT_BREAKER';
          const mins = Math.ceil(((cb.until || Date.now()) - Date.now()) / 60000);
          statusMessage = `Pausa por 2 SL consecutivos (${mins} min restantes)`;
        } else if (hourPerf.total >= this.minSamplesForHourFilter && hourPerf.winRatePct < this.minWinRateThreshold) {
          status = 'HORA_DESFAVORABLE';
          statusMessage = `Hora actual (${currentHour}:00) con bajo acierto (${hourPerf.winRatePct.toFixed(0)}%)`;
        }

        return {
          symbol: sym,
          status,
          statusMessage,
          consecutiveLosses: cb.consecutiveLosses,
          circuitBreakerActive: cb.active,
          currentHourWinRate: hourPerf.total > 0 ? hourPerf.winRatePct : null,
          currentSessionWinRate: sessionPerf.total > 0 ? sessionPerf.winRatePct : null,
        };
      }),
    );

    return {
      enabled: this.adaptiveEnabled,
      currentHour,
      currentSession,
      minWinRateThreshold: this.minWinRateThreshold,
      maxConsecutiveLosses: this.maxConsecutiveLosses,
      circuitBreakerMinutes: Math.round(this.circuitBreakerCooldownMs / 60000),
      symbols: symbolsStatus,
    };
  }

  toggleAdaptive(enabled?: boolean) {
    if (enabled !== undefined) {
      this.adaptiveEnabled = enabled;
    } else {
      this.adaptiveEnabled = !this.adaptiveEnabled;
    }
    this.logger.log(`⚙️ Retroalimentación adaptativa IA: ${this.adaptiveEnabled ? 'ON' : 'OFF'}`);
    return { enabled: this.adaptiveEnabled };
  }

  // ── Helper para determinar sesión a partir de la hora local ──
  getSessionFromHour(hour?: number | null): 'MADRUGADA' | 'MANANA' | 'TARDE' | 'NOCHE' {
    const h = hour !== null && hour !== undefined ? hour : new Date().getHours();
    if (h >= 0 && h < 6) return 'MADRUGADA';
    if (h >= 6 && h < 12) return 'MANANA';
    if (h >= 12 && h < 18) return 'TARDE';
    return 'NOCHE';
  }
}
