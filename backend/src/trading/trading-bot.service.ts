import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { TradeRecord } from './trade.entity';
import { CrashIaStrategyService } from '../strategies/crash-ia-strategy.service';
import { H1StrategyService } from '../strategies/h1-strategy.service';
import { M5PlusStrategyService } from '../strategies/m5plus-strategy.service';
import { M5XStrategyService } from '../strategies/m5x-strategy.service';
import { TradingStatsService } from './trading-stats.service';
import { UsersService } from '../users/users.service';
import { EvolutionCallService } from '../notifications/evolution-call.service';
import { WeySignalsService } from '../apex-signals/wey-signals.service';
import { CandlesService } from '../candles/candles.service';

@Injectable()
export class TradingBotService implements OnModuleInit {
  private readonly logger = new Logger(TradingBotService.name);

  // Configuraciones del Bot
  private h1AutoEnabled = true;
  private dashboardStarsAutoEnabled = true;
  private crashBoomAutoEnabled = true;
  private m5PlusAutoEnabled = false; // M5++ auto-trading (desactivado por defecto, activar desde el panel)
  private m5XAutoEnabled = false;
  private maxOpenTrades = 10;
  private maxOpenSymbols = 8; // Ampliado de 3 a 8 índices para permitir operar en varios activos a la vez
  private maxTradesPerSymbol = 1; // Máximo 1 entrada de la app por índice (trades manuales no cuentan)

  // Estado en memoria para respuesta de latencia cero
  private activeTradesMap = new Map<string, TradeRecord>();
  private lastTradeOpenedAt = new Map<string, number>(); // Cooldown por símbolo
  private tradesCountPerSymbol = new Map<string, number>(); // Registro de trades hoy por índice

  // ── LÍMITE DE 3 ENTRADAS POR ESTRATEGIA (contador de trades ABIERTOS activos por estrategia) ──
  // Regla: máximo 3 trades simultáneos de la app por cada estrategia
  private readonly MAX_TRADES_PER_STRATEGY = 3;

  // ── PROTECCIÓN ANTI-RACHA NEGATIVA ──
  // Cooldown global mínimo entre cualquier entrada en el mismo símbolo (cross-estrategia)
  private readonly GLOBAL_SYMBOL_COOLDOWN_MS = 5 * 60 * 1000;  // 5 minutos base
  private readonly LOSS_PENALTY_COOLDOWN_MS  = 10 * 60 * 1000; // +10 min extra si el último trade fue pérdida
  // lastSymbolTradeOpenedAt[symbol]: timestamp ms de la última entrada abierta (cualquier estrategia)
  private lastSymbolTradeOpenedAt = new Map<string, number>();
  // lastSymbolTradeResult[symbol]: 'WIN' | 'LOSS' | 'BREAKEVEN' del último trade cerrado en ese símbolo
  private lastSymbolTradeResult = new Map<string, 'WIN' | 'LOSS' | 'BREAKEVEN'>();

  // ── Detección de Spikes para H1_NO_WICK ──
  // lastSpikeAt[symbol]: timestamp (ms) del último spike detectado por símbolo
  // tradeLastSpikeTime[tradeId]: timestamp (ms) del último spike detectado para este trade específico
  // lastTickPrice[symbol]: último precio visto en ticks, para calcular el delta
  private lastSpikeAt = new Map<string, number>();
  private tradeLastSpikeTime = new Map<string, number>();
  private lastTickPrice = new Map<string, number>();

  // Puente directo con MetaTrader 5 (Deriv-Demo / Login: 6026360)
  private readonly mt5FilesDir =
    process.env.MT5_FILES_DIR ||
    'C:/Users/Weimar/AppData/Roaming/MetaQuotes/Terminal/FB9A56D617EDDDFE29EE54EBEFFE96C1/MQL5/Files';
  private readonly mt5CommandsFile = `${this.mt5FilesDir}/deriv_bridge_commands.json`;
  private readonly mt5FeedbackFile = `${this.mt5FilesDir}/deriv_bridge_feedback.json`;
  private readonly mt5PositionsFile = `${this.mt5FilesDir}/deriv_bridge_positions.json`;
  private readonly mt5HistoryFile = `${this.mt5FilesDir}/deriv_bridge_history.json`;
  private mt5Positions: any[] = [];
  private lastMt5SyncAt = 0;
  private pendingMt5Commands: any[] = [];
  private lastMt5OfflineWarningAt = 0;
  private readonly mt5BridgeTimeoutMs = 10_000;
  private readonly mt5OpenCommandMaxAgeMs = 60_000;
  private mt5TrackedMaxProfit = new Map<string, number>();
  private h1CandlesExecuted = new Set<string>();
  private doubleWickPatternsExecuted = new Set<string>();
  private m5XCandlesExecuted = new Set<string>();
  private lastM5XEvaluationAt = 0;
  private openingSymbolsInFlight = new Set<string>();
  private readonly h1AutoAuthorizedEmail = 'weimarsuber@gmail.com';
  private readonly h1EvaluationMinutes = [13, 28, 43, 58];
  private readonly h1ConfirmedEntryMinutes = [13, 28, 43, 58];
  private lastH1EvaluationMinuteKey = -1;
  private h1EvaluationInFlight = false;
  private lastH1AnalysisAt = 0;
  private lastDashboardEvaluationMinuteKey = -1;
  private lastCrashBoomAlertMinuteKey = -1;
  private crashBoomAlertInFlight = false;

  constructor(
    @InjectRepository(TradeRecord)
    private readonly tradeRepo: Repository<TradeRecord>,
    private readonly crashIaService: CrashIaStrategyService,
    private readonly h1Service: H1StrategyService,
    private readonly m5PlusService: M5PlusStrategyService,
    private readonly m5XService: M5XStrategyService,
    private readonly statsService: TradingStatsService,
    private readonly usersService: UsersService,
    private readonly evolutionCallService: EvolutionCallService,
    private readonly weySignalsService: WeySignalsService,
    private readonly candlesService: CandlesService,
    private readonly events: EventEmitter2,
  ) {}

  async onModuleInit() {
    // Cargar trades abiertos previos si los hubiera
    try {
      const openTrades = await this.tradeRepo.find({
        where: { status: 'OPEN' },
      });
      for (const t of openTrades) {
        this.activeTradesMap.set(t.id, t);
      }
      this.logger.log(`🤖 TradingBot inicializado con ${openTrades.length} trades activos en seguimiento.`);

      // Contar trades de hoy por símbolo para respetar el límite de 2 trades por índice
      const startOfDaySec = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
      const todaysTrades = await this.tradeRepo
        .createQueryBuilder('trade')
        .where('trade.entryTime >= :startOfDaySec', { startOfDaySec })
        .getMany();

      for (const t of todaysTrades) {
        const c = this.tradesCountPerSymbol.get(t.symbol) || 0;
        this.tradesCountPerSymbol.set(t.symbol, c + 1);
      }
      // Limpiar trades fantasma previos para no corromper estadísticas
      await this.tradeRepo
        .createQueryBuilder()
        .update(TradeRecord)
        .set({ pnlUsd: 0, pnlPoints: 0, pnlPercent: 0, result: 'BREAKEVEN' })
        .where('exitReason = :reason', { reason: 'MT5_TIMEOUT_NO_FILL' })
        .execute();
    } catch (e) {
      this.logger.warn(`No se pudieron cargar trades previos de BD: ${e?.message}`);
    }


    // Iniciar bucle de evaluación de estrategias en alta frecuencia (cada 2.5s) para ejecución inmediata
    setInterval(() => {
      this.evaluateStrategiesLoop().catch((err) =>
        this.logger.debug(`Error en ciclo de evaluación: ${err?.message}`),
      );
    }, 2_500);

    // Iniciar verificación de salidas de trades (SL 10 min / 10 velas M1 y salida post-spike) cada 3 segundos
    setInterval(() => {
      this.checkActiveTradeExits().catch(() => {});
    }, 3_000);

    // Sincronización continua de feedback desde MetaTrader 5 (cada 2 segundos)
    setInterval(() => {
      this.pollMt5Feedback().catch(() => {});
    }, 2_000);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── 1. GESTIÓN DE CONFIGURACIÓN Y CONSULTAS ────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Cuenta cuántos trades ABIERTOS de la app hay actualmente para una estrategia dada.
   * Esto permite respetar el límite de 3 entradas por estrategia.
   */
  private getOpenTradeCountByStrategy(strategy: 'H1_NO_WICK' | 'CRASH_BOOM_IA' | 'DOUBLE_WICK_MECHA' | 'M5_PLUS' | 'M5_X'): number {
    let count = 0;
    for (const trade of this.activeTradesMap.values()) {
      if (trade.status === 'OPEN' && trade.strategy === strategy) {
        count++;
      }
    }
    return count;
  }

  private hasOpenH1Trade(): boolean {
    const hasApp = Array.from(this.activeTradesMap.values()).some(
      (trade) => trade.status === 'OPEN' && trade.strategy === 'H1_NO_WICK',
    );
    if (hasApp) return true;
    return (this.mt5Positions || []).some(
      (pos) => Number(pos?.magic) === 999888 && (pos?.comment || '').includes('H1'),
    );
  }

  private getActiveSymbolCount(): number {
    const symbols = new Set<string>();
    for (const trade of this.activeTradesMap.values()) {
      if (trade.status === 'OPEN' && trade.symbol) {
        symbols.add(this.normalizeSymbol(trade.symbol));
      }
    }
    // Solo contar posiciones de MT5 que correspondan a operaciones automáticas del bot (Magic 999888)
    // para que las posiciones manuales del usuario no le bloqueen el cupo al bot
    for (const pos of this.mt5Positions || []) {
      if (Number(pos?.magic) === 999888 && pos?.symbol) {
        symbols.add(this.normalizeSymbol(pos.symbol));
      }
    }
    return symbols.size;
  }

  normalizeSymbol(symbol: string): string {
    const s = (symbol || '')
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace('INDEX', '');
    if (s.includes('CRASH1000')) return 'CRASH1000';
    if (s.includes('BOOM1000')) return 'BOOM1000';
    if (s.includes('CRASH300')) return 'CRASH300';
    if (s.includes('BOOM300')) return 'BOOM300';
    if (s.includes('CRASH900')) return 'CRASH900';
    if (s.includes('BOOM900')) return 'BOOM900';
    if (s.includes('CRASH600')) return 'CRASH600';
    if (s.includes('BOOM600')) return 'BOOM600';
    if (s.includes('CRASH500')) return 'CRASH500';
    if (s.includes('BOOM500')) return 'BOOM500';
    return s;
  }

  toMt5Symbol(symbol: string): string {
    return this.normalizeSymbol(symbol);
  }

  getConfig() {
    return {
      h1AutoEnabled: this.h1AutoEnabled,
      dashboardStarsAutoEnabled: this.dashboardStarsAutoEnabled,
      crashBoomAutoEnabled: this.crashBoomAutoEnabled,
      m5PlusAutoEnabled: this.m5PlusAutoEnabled,
      m5XAutoEnabled: this.m5XAutoEnabled,
      maxOpenTrades: this.maxOpenTrades,
      maxOpenSymbols: this.maxOpenSymbols,
      maxTradesPerSymbol: this.maxTradesPerSymbol,
      tradesCountPerSymbol: Object.fromEntries(this.tradesCountPerSymbol.entries()),
      activeCount: this.activeTradesMap.size,
      activeSymbolCount: this.getActiveSymbolCount(),
    };
  }

  toggleConfig(key: 'h1' | 'crashBoom' | 'm5Plus' | 'm5X', val?: boolean) {
    if (key === 'h1') {
      this.h1AutoEnabled = val !== undefined ? val : !this.h1AutoEnabled;
    } else if (key === 'crashBoom') {
      this.crashBoomAutoEnabled = val !== undefined ? val : !this.crashBoomAutoEnabled;
    } else if (key === 'm5Plus') {
      this.m5PlusAutoEnabled = val !== undefined ? val : !this.m5PlusAutoEnabled;
    } else if (key === 'm5X') {
      this.m5XAutoEnabled = val !== undefined ? val : !this.m5XAutoEnabled;
    }
    return this.getConfig();
  }

  resetSymbolTradesCount(symbol?: string) {
    if (symbol) {
      this.tradesCountPerSymbol.delete(symbol);
    } else {
      this.tradesCountPerSymbol.clear();
    }
    return this.getConfig();
  }

  getMinSlPoints(symbol: string): number {
    const up = (symbol || '').toUpperCase();
    if (up.includes('600') && up.includes('CRASH')) return 26.6; // ~8 USD a 0.30 lotes
    return 10.0; // ~5 USD a 0.50 lotes
  }

  getMaxSlUsd(symbol: string): number {
    const up = (symbol || '').toUpperCase();
    if (up.includes('600') && up.includes('CRASH')) return 8.0;
    return 5.0;
  }

  getMaxSlPoints(symbol: string, lot = 0.5): number {
    const maxUsd = this.getMaxSlUsd(symbol);
    const safeLot = lot > 0 ? lot : this.getDefaultLotForSymbol(symbol) || 0.5;
    return Number((maxUsd / safeLot).toFixed(3));
  }

  /**
   * Verifica si la tendencia macro (EMA 20 en M15) favorece la dirección de la operación.
   * — Para CRASH (SELL): favorable si precio <= EMA20 (tendencia bajista/lateral).
   * — Para BOOM (BUY): favorable si precio >= EMA20 (tendencia alcista/lateral).
   * Si el precio está claramente encima de la EMA20 y queremos SELL → tendencia contraria → bloquear.
   * Usa velas M15 de la BD (granularity=900). Si no hay suficientes datos, permite la entrada por defecto.
   */
  private async isTrendFavorable(symbol: string, direction: 'BUY' | 'SELL'): Promise<{
    favorable: boolean;
    trendLabel: 'ALCISTA' | 'BAJISTA' | 'LATERAL';
    ema20: number;
    currentPrice: number;
    reason: string;
  }> {
    try {
      const candles = await this.candlesService.findLatest(symbol, 900, 30); // M15
      if (!candles || candles.length < 20) {
        return { favorable: true, trendLabel: 'LATERAL', ema20: 0, currentPrice: 0, reason: 'Sin suficientes velas M15 para evaluar tendencia; entrada permitida.' };
      }

      const sorted = [...candles].sort((a, b) => Number(a.epoch) - Number(b.epoch));
      const closes = sorted.map((c) => Number(c.close));
      const currentPrice = this.lastTickPrice.get(symbol) || closes[closes.length - 1];

      // Calcular EMA-20
      const period = 20;
      const k = 2 / (period + 1);
      let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
      for (let i = period; i < closes.length; i++) {
        ema = closes[i] * k + ema * (1 - k);
      }

      // Margen del 0.15% para evitar bloqueos en zonas laterales (precio muy cerca de EMA)
      const marginPct = 0.0015;
      const upperBand = ema * (1 + marginPct);
      const lowerBand = ema * (1 - marginPct);

      let trendLabel: 'ALCISTA' | 'BAJISTA' | 'LATERAL';
      if (currentPrice > upperBand) trendLabel = 'ALCISTA';
      else if (currentPrice < lowerBand) trendLabel = 'BAJISTA';
      else trendLabel = 'LATERAL';

      // Para SELL (índices Crash): Bloquear si tendencia es ALCISTA (precio claramente encima de EMA20)
      // Para BUY (índices Boom): Bloquear si tendencia es BAJISTA (precio claramente debajo de EMA20)
      const favorable = direction === 'SELL'
        ? trendLabel !== 'ALCISTA'   // Crash: OK si bajista o lateral
        : trendLabel !== 'BAJISTA';  // Boom: OK si alcista o lateral

      const reason = favorable
        ? `Tendencia M15 ${trendLabel} (EMA20: ${ema.toFixed(3)}, precio: ${currentPrice.toFixed(3)}) — compatible con ${direction}.`
        : `Tendencia M15 ${trendLabel} CONTRA ${direction}: precio (${currentPrice.toFixed(3)}) ${direction === 'SELL' ? 'por encima' : 'por debajo'} de EMA20 (${ema.toFixed(3)}). Entrada bloqueada.`;

      return { favorable, trendLabel, ema20: Number(ema.toFixed(3)), currentPrice: Number(currentPrice.toFixed(3)), reason };
    } catch (e) {
      this.logger.debug(`Error calculando tendencia M15 para ${symbol}: ${e?.message}`);
      return { favorable: true, trendLabel: 'LATERAL', ema20: 0, currentPrice: 0, reason: `Error calculando EMA20; entrada permitida por defecto.` };
    }
  }

  getActiveTrades(): TradeRecord[] {
    return Array.from(this.activeTradesMap.values()).sort(
      (a, b) => Number(b.entryTime) - Number(a.entryTime),
    );
  }

  async getTradeHistory(limit = 50): Promise<TradeRecord[]> {
    try {
      return await this.tradeRepo.find({
        where: { status: 'CLOSED' },
        order: { exitTime: 'DESC' },
        take: limit,
      });
    } catch (e) {
      return [];
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── 2. ACTUALIZACIÓN EN TIEMPO REAL CON TICKS DE DERIV ─────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  @OnEvent('deriv.tick')
  handleTick(tick: { symbol: string; quote: number; epoch: number }) {
    if (!tick || !tick.symbol || !tick.quote) return;

    const currentPrice = Number(tick.quote);
    const sym = tick.symbol;

    // ── Detección de Spike en tiempo real para H1_NO_WICK ──
    // Un spike es un movimiento brusco de precio en un solo tick, relativo al símbolo.
    const prevPrice = this.lastTickPrice.get(sym);
    if (prevPrice && prevPrice > 0) {
      const delta = Math.abs(currentPrice - prevPrice);
      const spikeThreshold = this.getSpikeThreshold(sym);
      if (delta >= spikeThreshold || delta >= 3.5) {
        const prevSpikeAt = this.lastSpikeAt.get(sym) || 0;
        const now = Date.now();
        this.lastSpikeAt.set(sym, now);
        if (now - prevSpikeAt > 30_000) {
          this.logger.log(
            `⚡ [SPIKE DETECTADO] ${sym}: delta ${delta.toFixed(3)} pts (umbral: ${spikeThreshold}). Spike registrado.`,
          );
        }

        // Asociar el spike inmediatamente a cualquier trade activo que se beneficie de él
        for (const trade of this.activeTradesMap.values()) {
          if (trade.symbol === sym && trade.status === 'OPEN') {
            const isFavorable =
              (trade.direction === 'BUY' && currentPrice > prevPrice) ||
              (trade.direction === 'SELL' && currentPrice < prevPrice);
            if (isFavorable) {
              const prevTradeSpike = this.tradeLastSpikeTime.get(trade.id) || 0;
              this.tradeLastSpikeTime.set(trade.id, now);
              trade.hadSpike = true;
              if (now - prevTradeSpike > 15_000) {
                trade.spikeCount = (trade.spikeCount || 0) + 1;
                this.logger.log(
                  `⚡ [SPIKE REGISTRADO EN TRADE ${trade.strategy}] ${sym} (${trade.id}): Spike a favor #${trade.spikeCount} detectado. Iniciando espera obligatoria de 5 minutos antes de evaluar salida.`,
                );
              }
            }
          }
        }
      }
    }
    this.lastTickPrice.set(sym, currentPrice);

    for (const trade of this.activeTradesMap.values()) {
      if (trade.symbol === sym && trade.status === 'OPEN') {
        trade.currentPrice = currentPrice;

        // Calcular PnL en puntos
        if (trade.direction === 'BUY') {
          trade.pnlPoints = Number((currentPrice - trade.entryPrice).toFixed(3));
        } else {
          trade.pnlPoints = Number((trade.entryPrice - currentPrice).toFixed(3));
        }

        trade.pnlPercent = Number(
          ((trade.pnlPoints / trade.entryPrice) * 100).toFixed(2),
        );

        // ── Rastrear ganancia máxima alcanzada (High Watermark en puntos y USD) ──
        if (trade.pnlPoints > (trade.maxProfitPoints || 0)) {
          trade.maxProfitPoints = trade.pnlPoints;
        }

        const lot = trade.lot || this.getDefaultLotForSymbol(trade.symbol);
        const estUsd = trade.pnlUsd || Number((trade.pnlPoints * lot).toFixed(2));
        if (estUsd > (trade.maxProfitUsd || 0)) {
          trade.maxProfitUsd = estUsd;
        }

        // Si el trade experimenta un avance de ganancia equivalente al spike (por puntos o profit en USD)
        const spikeThresh = this.getSpikeThreshold(sym);
        const hasSpikeGain =
          trade.pnlPoints >= spikeThresh ||
          trade.pnlPoints >= 3.5 ||
          ((trade.pnlUsd || 0) >= 1.50);

        if (hasSpikeGain) {
          trade.hadSpike = true;
          const prevTradeSpike = this.tradeLastSpikeTime.get(trade.id) || 0;
          const now = Date.now();
          if (now - prevTradeSpike > 20_000) {
            trade.spikeCount = (trade.spikeCount || 0) + 1;
            this.tradeLastSpikeTime.set(trade.id, now);
            this.lastSpikeAt.set(sym, now);
            this.logger.log(
              `⚡ [SPIKE DETECTADO POR PROFIT] ${sym} (${trade.strategy}): PnL alcanzado +${trade.pnlPoints} pts / +$${trade.pnlUsd || 0} USD (Spike #${trade.spikeCount}). Registrando espera obligatoria de 5 minutos tras el spike.`,
            );
          }
        }
      }
    }
  }

  /**
   * Retorna el umbral de puntos para considerar un movimiento de precio como spike,
   * diferenciado por índice (los sintéticos tienen escalas muy distintas).
   */
  private getSpikeThreshold(symbol: string): number {
    const up = (symbol || '').toUpperCase();
    // Crash/Boom 100 y 200 tienen spikes de 50-200+ pts
    if (up.includes('100') && !up.includes('1000')) return 30.0;
    if (up.includes('200')) return 35.0;
    // Crash/Boom 300 y 500
    if (up.includes('300')) return 25.0;
    if (up.includes('500')) return 20.0;
    // Crash/Boom 600 y 900
    if (up.includes('600')) return 15.0;
    if (up.includes('900')) return 12.0;
    // Crash/Boom 1000
    if (up.includes('1000')) return 10.0;
    return 15.0;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── 3. SALIDAS POR TIEMPO Y SPIKE: SL 10 MIN (10 VELAS M1) + POST-SPIKE PROFIT ──
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Lógica universal de salida para operaciones de índices sintéticos:
   *
   * A) STOP LOSS POR TIEMPO (10 MINUTOS / 10 VELAS M1):
   *    Si transcurren 10 minutos desde la entrada y no se ha detectado ningún spike
   *    en el símbolo posterior a la entrada → cerrar el trade por Stop Loss de tiempo.
   *
   * B) SALIDA POST-SPIKE EN PROFIT (5 MIN TRAS SPIKE):
   *    Si ocurrió un spike después de la entrada y transcurrieron 5 minutos desde
   *    el último spike → si el trade está en profit, cerrar asegurando ganancia.
   *
   * C) TIMEOUT DE SEGURIDAD POST-SPIKE:
   *    Si hubo spike pero pasan 20 min desde la entrada sin alcanzar profit, cerrar.
   */
  async checkActiveTradeExits() {
    const nowMs = Date.now();
    const TIMEOUT_NO_SPIKE_MS = 10 * 60 * 1000; // 10 minutos (10 velas M1 sin spike)
    const POST_SPIKE_WAIT_MS  = 5 * 60 * 1000; // 5 minutos tras el spike

    for (const trade of this.activeTradesMap.values()) {
      if (trade.status !== 'OPEN') continue;

      const entryMs = Number(trade.entryTime) * 1000;
      const elapsedMs = nowMs - entryMs;
      const elapsedSec = Math.floor(elapsedMs / 1000);

      // ── A0) CONTROL ESTRICTO DE STOP LOSS MONETARIO ($5 USD / $8 USD Crash 600) ──
      const maxLossUsd = this.getMaxSlUsd(trade.symbol);
      const lot = trade.lot || this.getDefaultLotForSymbol(trade.symbol) || 0.5;
      const currentPnlUsd = (trade.pnlUsd !== undefined && trade.pnlUsd !== 0)
        ? trade.pnlUsd
        : Number((trade.pnlPoints * lot).toFixed(2));

      if (currentPnlUsd <= -maxLossUsd) {
        this.logger.log(
          `🛑 [STOP LOSS MONETARIO -$${maxLossUsd} USD] ${trade.symbol} (${trade.direction} - ${trade.strategy}): Pérdida flotante de $${currentPnlUsd.toFixed(2)} USD alcanzó el límite permitido (-$${maxLossUsd} USD). Cerrando trade inmediatamente.`,
        );
        await this.closeTrade(
          trade.id,
          `SL_MAX_LOSS_${maxLossUsd}USD`,
          trade.currentPrice || trade.entryPrice,
        );
        continue;
      }

      const tradeSpikeTime = this.tradeLastSpikeTime.get(trade.id) || 0;
      const symbolSpikeTime = this.lastSpikeAt.get(trade.symbol) || 0;
      const lastSpike = trade.strategy === 'H1_NO_WICK'
        ? tradeSpikeTime
        : tradeSpikeTime || (symbolSpikeTime > entryMs ? symbolSpikeTime : 0);
      const spikeOccurredAfterEntry = !!lastSpike && lastSpike > entryMs;
      const msSinceSpike = spikeOccurredAfterEntry ? (nowMs - lastSpike) : Infinity;

      // ── A) STOP LOSS POR TIEMPO: 10 min (10 velas M1) desde entrada sin spike ──
      if (!spikeOccurredAfterEntry) {
        if (elapsedMs >= TIMEOUT_NO_SPIKE_MS) {
          this.logger.log(
            `⏰ [STOP LOSS 10 MIN / 10 VELAS M1] ${trade.symbol} (${trade.direction} - ${trade.strategy}): Transcurrieron ${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s sin spike. Cerrando por Stop Loss. PnL: ${trade.pnlPoints} pts ($${currentPnlUsd} USD).`,
          );
          await this.closeTrade(
            trade.id,
            'SL_10_MIN_NO_SPIKE',
            trade.currentPrice || trade.entryPrice,
          );
        }
        continue;
      }

      // ── B) Salida Post-Spike: OBLIGATORIO ESPERAR 5 MINUTOS TRAS EL SPIKE ──
      // EXCEPCIÓN CRÍTICA: Si el profit cae significativamente desde el máximo (trailing stop por profit),
      // se cierra INMEDIATAMENTE aunque no hayan pasado los 5 minutos, para proteger las ganancias.
      if (spikeOccurredAfterEntry) {
        const lot2 = trade.lot || this.getDefaultLotForSymbol(trade.symbol) || 0.5;
        const currentPnlUsd2 = (trade.pnlUsd !== undefined && trade.pnlUsd !== 0)
          ? trade.pnlUsd
          : Number((trade.pnlPoints * lot2).toFixed(2));
        const maxProfitUsd = Number(((trade.maxProfitPoints || 0) * lot2).toFixed(2));

        // ── PROTECCIÓN DEL 70% DEL PROFIT MÁXIMO ──
        // Regla: Si el profit máximo alcanzado fue >= $6 USD y el profit actual
        // cae por debajo del 70% de ese máximo → cerrar de inmediato para proteger las ganancias.
        // Aplica en todo momento, incluso dentro de los 5 minutos post-spike.
        // Ejemplo: llegó a $36 USD → cierra si baja de $25.2 USD (70% de $36)
        if (maxProfitUsd >= 6.0) {
          const protectedThreshold = maxProfitUsd * 0.70;
          if (currentPnlUsd2 < protectedThreshold) {
            this.logger.log(
              `🔒 [PROTECCIÓN 70% PROFIT] ${trade.symbol} (${trade.direction} - ${trade.strategy}): Profit máximo: +$${maxProfitUsd.toFixed(2)} USD. Profit actual: +$${currentPnlUsd2.toFixed(2)} USD cayó por debajo del 70% (umbral: $${protectedThreshold.toFixed(2)} USD). Cerrando para proteger ganancias.`,
            );
            await this.closeTrade(
              trade.id,
              `PROTECT_70PCT_MAX_${maxProfitUsd.toFixed(0)}USD`,
              trade.currentPrice || trade.entryPrice,
            );
            continue;
          }
        }

        // 1. SI AÚN NO HAN PASADO LOS 5 MINUTOS TRAS EL SPIKE (y trailing stop no aplicó):
        if (msSinceSpike < POST_SPIKE_WAIT_MS) {
          const remainingSec = Math.round((POST_SPIKE_WAIT_MS - msSinceSpike) / 1000);
          this.logger.debug(
            `⏳ [ESPERA OBLIGATORIA 5 MIN POST-SPIKE] ${trade.symbol} (${trade.strategy}): Han pasado ${Math.floor((msSinceSpike / 1000) / 60)}m ${Math.floor((msSinceSpike / 1000) % 60)}s tras el spike. Faltan ${remainingSec}s. Profit actual: +$${currentPnlUsd2.toFixed(2)} USD (máx: +$${maxProfitUsd.toFixed(2)} USD).`,
          );
          continue;
        }

        // 2. Si YA transcurrieron los 5 minutos completos tras el spike:
        // Condición A: Ganancia >= $5.00 USD tras 5 minutos -> Cerrar asegurando profit
        if (currentPnlUsd2 >= 5.0) {
          this.logger.log(
            `🎯 [POST-SPIKE PROFIT >= $5 USD] ${trade.symbol} (${trade.direction} - ${trade.strategy}): Cumplidos 5 min tras spike con ganancia de +$${currentPnlUsd2.toFixed(2)} USD (>= $5 USD). Cerrando con profit asegurado.`,
          );
          await this.closeTrade(
            trade.id,
            'POST_SPIKE_5_MIN_PROFIT_5USD',
            trade.currentPrice || trade.entryPrice,
          );
          continue;
        }

        // Condición B: Ganancia < $5.00 USD tras 5 minutos -> Se deja correr.
        // Pero si el precio se regresa al PUNTO DE INICIO (precio de entrada / breakeven) -> Cerrar en punto de inicio
        const isBackToEntryPoint = trade.direction === 'BUY'
          ? (trade.currentPrice <= trade.entryPrice || currentPnlUsd2 <= 0.05)
          : (trade.currentPrice >= trade.entryPrice || currentPnlUsd2 <= 0.05);

        if (isBackToEntryPoint) {
          this.logger.log(
            `🛡️ [SALIDA EN PUNTO DE INICIO] ${trade.symbol} (${trade.direction}): Tras 5 min del spike no alcanzó los $5 USD (+${currentPnlUsd2.toFixed(2)} USD) y retrocedió al precio de entrada (${trade.entryPrice}). Cerrando en Breakeven sin pérdidas.`,
          );
          await this.closeTrade(
            trade.id,
            'EXIT_AT_ENTRY_POINT_BREAKEVEN',
            trade.entryPrice,
          );
          continue;
        } else {
          this.logger.debug(
            `⏳ [DEJANDO CORRER TRAS 5 MIN] ${trade.symbol} (${trade.direction}): 5 min post-spike con +$${currentPnlUsd2.toFixed(2)} USD (< $5 USD). Dejando correr buscando spike mayor o salida en punto de inicio.`,
          );
        }
      }

      // ── C) Timeout de seguridad post-spike: 20 min desde entrada sin alcanzar meta ──
      if (spikeOccurredAfterEntry && elapsedMs >= 20 * 60 * 1000 && (trade.pnlUsd || 0) < 5.0) {
        this.logger.log(
          `⏰ [TIMEOUT POST-SPIKE 20 MIN] ${trade.symbol} (${trade.direction} - ${trade.strategy}): 20 min desde entrada sin alcanzar $5 USD. Cerrando trade.`,
        );
        await this.closeTrade(
          trade.id,
          'TIMEOUT_POST_SPIKE',
          trade.currentPrice || trade.entryPrice,
        );
        continue;
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── 4. EVALUACIÓN Y APERTURA DE OPERACIONES ────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  async evaluateStrategiesLoop() {
    const now = new Date();
    const minuteKey = Math.floor(now.getTime() / 60_000);
    const isScheduledWindow = this.h1EvaluationMinutes.includes(now.getMinutes());

    // El radar se envia cuatro veces por hora aunque nadie tenga abierta la pantalla.
    // El autotrade conserva su regla independiente de usuario online.
    if (
      isScheduledWindow &&
      this.lastCrashBoomAlertMinuteKey !== minuteKey &&
      !this.crashBoomAlertInFlight
    ) {
      this.lastCrashBoomAlertMinuteKey = minuteKey;
      this.crashBoomAlertInFlight = true;
      try {
        await this.evaluateScheduledCrashBoomAlerts(minuteKey);
      } catch (error: any) {
        this.logger.error(`Error publicando radar Crash/Boom: ${error?.message || error}`);
      } finally {
        this.crashBoomAlertInFlight = false;
      }
    }

    // ── REGLA CRÍTICA USUARIO: Si weimarsuber@gmail.com no está logueado en la app, NO hacer autotrade ──
    const isUserOnline = await this.isUserAuthorizedOnline();

    // A. Evaluación Estrategia H1 Sin Mecha (Velas Marubozu)
    // H1 es una señal directa y no depende del cupo global de las otras estrategias.
    const shouldEvaluateDashboard =
      this.h1EvaluationMinutes.includes(now.getMinutes()) &&
      this.lastDashboardEvaluationMinuteKey !== minuteKey;
    const isH1ImmediateWindow = now.getMinutes() === 59 || now.getMinutes() <= 2;
    const isH1ScheduledWindow = this.h1EvaluationMinutes.includes(now.getMinutes());

    // H1 se evalua en la ventana especial :59-:02 y en los minutos programados.
    if (
      (isH1ImmediateWindow || isH1ScheduledWindow) &&
      Date.now() - this.lastH1AnalysisAt >= 5_000 &&
      !this.h1EvaluationInFlight
    ) {
      this.lastH1AnalysisAt = Date.now();
      this.h1EvaluationInFlight = true;
      try {
        await this.evaluateH1Strategy(this.h1AutoEnabled && isUserOnline);
      } finally {
        this.h1EvaluationInFlight = false;
      }
    }

    if (!isUserOnline) return;

    if (this.dashboardStarsAutoEnabled && shouldEvaluateDashboard) {
      this.lastDashboardEvaluationMinuteKey = minuteKey;
      // Señales del dashboard con 4★ o más: solo si está expresamente habilitado
      await this.evaluateDashboardStarsStrategy();
    }

    if (this.activeTradesMap.size >= this.maxOpenTrades) return;

    // B. Evaluación Estrategia Crash & Boom IA (Entre línea morada y punteada)
    if (this.crashBoomAutoEnabled) {
      await this.evaluateCrashBoomStrategy();
    }

    // C. Evaluación Estrategia M5++ (Compresión + Ruptura → Spike)
    if (this.m5PlusAutoEnabled) {
      await this.evaluateM5PlusStrategy();
    }

    // D. M5X: vela verde chata cerrada en indices Crash.
    if (this.m5XAutoEnabled) {
      await this.evaluateM5XStrategy();
    }
  }

  private async evaluateM5XStrategy() {
    try {
      const nowMs = Date.now();
      const secondsIntoM5 = Math.floor(nowMs / 1000) % 300;
      if (secondsIntoM5 > 90 || nowMs - this.lastM5XEvaluationAt < 5_000) return;
      this.lastM5XEvaluationAt = nowMs;

      if (this.getOpenTradeCountByStrategy('M5_X') >= this.MAX_TRADES_PER_STRATEGY) return;

      const signals = await this.m5XService.evaluateLiveAll();
      if (!Array.isArray(signals)) return;

      const nowEpoch = Math.floor(nowMs / 1000);
      for (const signal of signals) {
        if (!signal.patternDetected || !signal.symbol || signal.direction !== 'SELL') continue;
        if (signal.dataSource !== 'MT5') continue;

        const patternEpoch = Number(signal.patternEpoch);
        const patternCloseEpoch = Number(signal.patternCloseEpoch || patternEpoch + 300);
        const secondsSinceClose = nowEpoch - patternCloseEpoch;

        // La orden solo pertenece al inicio de la vela siguiente. Una senal vieja no se opera.
        if (!Number.isFinite(patternEpoch) || secondsSinceClose < 0 || secondsSinceClose > 90) continue;

        const candleKey = `${signal.symbol}_${patternEpoch}`;
        if (this.m5XCandlesExecuted.has(candleKey)) continue;

        const cooldownKey = `${signal.symbol}_M5X`;
        const lastOpen = this.lastTradeOpenedAt.get(cooldownKey) || 0;
        if (Date.now() - lastOpen < 300_000) continue;

        const openForSymbol = Array.from(this.activeTradesMap.values()).filter(
          (trade) => trade.status === 'OPEN' && this.isSameSymbol(trade.symbol, signal.symbol),
        ).length;
        if (openForSymbol >= this.maxTradesPerSymbol) continue;

        const openedTrade = await this.openTrade({
          strategy: 'M5_X',
          symbol: signal.symbol,
          mercado: signal.mercado,
          direction: 'SELL',
          entryPrice: signal.entryPrice,
          stopLossPrice: signal.stopLossPrice,
        });

        if (openedTrade) {
          this.lastTradeOpenedAt.set(cooldownKey, Date.now());
          this.m5XCandlesExecuted.add(candleKey);
          if (this.m5XCandlesExecuted.size > 500) {
            this.m5XCandlesExecuted = new Set(Array.from(this.m5XCandlesExecuted).slice(-250));
          }
          this.logger.log(
            `[M5X] ${signal.symbol} SELL enviada a MT5 por vela verde chata cerrada en ${patternEpoch}.`,
          );
        }
      }
    } catch (error: any) {
      this.logger.debug(`Error evaluando M5X: ${error?.message}`);
    }
  }

  private async evaluateM5PlusStrategy() {
    try {
      // Límite: máximo 3 trades M5_PLUS abiertos simultáneos
      if (this.getOpenTradeCountByStrategy('M5_PLUS') >= this.MAX_TRADES_PER_STRATEGY) return;

      const signals = await this.m5PlusService.evaluateLiveAll();
      if (!Array.isArray(signals)) return;

      for (const signal of signals) {
        if (!signal.patternDetected) continue;
        if (!signal.symbol || !signal.direction) continue;

        // Cooldown: no re-entrar en el mismo símbolo antes de 3 minutos
        const cooldownKey = `${signal.symbol}_M5PLUS`;
        const lastOpen = this.lastTradeOpenedAt.get(cooldownKey) || 0;
        if (Date.now() - lastOpen < 180_000) continue;

        // Límite por símbolo
        const openForSymbol = Array.from(this.activeTradesMap.values()).filter(
          (t) => t.status === 'OPEN' && this.isSameSymbol(t.symbol, signal.symbol),
        ).length;
        if (openForSymbol >= this.maxTradesPerSymbol) continue;

        this.lastTradeOpenedAt.set(cooldownKey, Date.now());
        this.logger.log(
          `📐 [M5++] ${signal.symbol} ${signal.direction} — doji ${signal.dojiBody} pts / ${signal.dojiWickRatio}% mecha + señal ${signal.signalBody} pts. Entrada: ${signal.entryPrice}`,
        );

        await this.openTrade({
          strategy: 'M5_PLUS',
          symbol: signal.symbol,
          mercado: signal.mercado,
          direction: signal.direction,
          entryPrice: signal.entryPrice,
          stopLossPrice: signal.stopLossPrice,
        });
      }
    } catch (e) {
      this.logger.debug(`Error evaluando M5++: ${e?.message}`);
    }
  }

  private async evaluateH1Strategy(allowAutoTrading: boolean) {
    try {
      const h1Analysis = await this.h1Service.analyzeAllIndices(2);
      if (!h1Analysis || !Array.isArray(h1Analysis.activeAlerts)) return false;
      if (!h1Analysis.activeAlerts.length) return false;

      if (h1Analysis.activeAlerts.length) {
        const anticipatedAlerts = h1Analysis.activeAlerts.filter((alert) => alert.isAnticipated);
        const confirmedAlerts = h1Analysis.activeAlerts.filter((alert) => !alert.isAnticipated);
        const hourKey = Math.floor(Date.now() / 3_600_000);

        if (anticipatedAlerts.length) {
          void this.evolutionCallService.notifyH1Alerts(anticipatedAlerts, `anticipated-${hourKey}`).catch((err) => {
            this.logger.error(`Error enviando alertas H1 anticipadas por WhatsApp: ${err?.message || err}`);
          });
        }
        if (confirmedAlerts.length) {
          void this.evolutionCallService
            .notifyH1Alerts(confirmedAlerts, `confirmed-${hourKey}`)
            .catch((err) => {
              this.logger.error(`Error enviando alertas H1 confirmadas por WhatsApp: ${err?.message || err}`);
            });
        }
      }

      // WhatsApp se notifica a todos los usuarios con telefono. H1 automatico
      // no depende de que el usuario tenga la pantalla abierta o activa.
      if (!allowAutoTrading) {
        return true;
      }

      if (!this.isMt5BridgeConnected()) {
        const now = Date.now();
        if (now - this.lastMt5OfflineWarningAt >= 60_000) {
          this.lastMt5OfflineWarningAt = now;
          this.logger.warn(
            '[H1 NO WICK] Senal detectada, pero MT5 Bridge esta desconectado. No se creara una operacion fantasma.',
          );
        }
        return true;
      }

      if (this.hasOpenH1Trade()) {
        return true;
      }

      const currentMinute = new Date().getMinutes();
      const isImmediateWindow = currentMinute === 59 || currentMinute <= 2;

      for (const alert of h1Analysis.activeAlerts) {
        if (!alert.symbol || this.hasOpenH1Trade()) continue;

        if (!alert.historicalReaction?.found) {
          this.logger.warn(
            `[H1 NO WICK] ${alert.symbol}: sin reaccion historica cerca de ${alert.close}; se mantiene la entrada por señal directa de vela sin mecha.`,
          );
        }

        if (alert.h4AgainstTrade) {
          this.logger.warn(
            `[H1 NO WICK] ${alert.symbol}: H4 ${alert.h4Trend} esta en contra, pero existe reaccion historica confirmada en el nivel.`,
          );
        }

        // ── REGLA USUARIO: H1_NO_WICK opera por señal horaria directa ──
        const isAnticipated = Boolean((alert as any).isAnticipated);

        if (currentMinute === 58 && !isAnticipated) continue;

        const candleEpoch = Number((alert as any).epoch) || Math.floor(Date.now() / 3600000) * 3600;
        const candleKey = `${alert.symbol}_${candleEpoch}`;

        // ── FILTRO ANTI-REPETICIÓN ESTRICTO: Máximo 1 entrada por cada vela H1 (1 hora completa) ──
        if (this.h1CandlesExecuted.has(candleKey)) continue;

        // Cooldown obligatorio de 20 minutos entre señales H1 del mismo símbolo
        const lastH1Time = this.lastTradeOpenedAt.get(`${alert.symbol}_H1`) || 0;
        if (Date.now() - lastH1Time < 20 * 60 * 1000) continue;

        // Candado preventivo inmediato para evitar condiciones de carrera paralelas
        this.h1CandlesExecuted.add(candleKey);
        this.lastTradeOpenedAt.set(`${alert.symbol}_H1`, Date.now());

        const nowMs = Date.now();
        const targetTimeSec = candleEpoch + 3600;

        const symUp = (alert.symbol || '').toUpperCase();
        const isBoom = symUp.includes('BOOM');
        const isCrash = symUp.includes('CRASH');

        // ── REGLA H1 SIN MECHA UNIVERSAL ──
        const direction: 'BUY' | 'SELL' = isBoom ? 'BUY' : 'SELL';
        const livePrice = this.lastTickPrice.get(alert.symbol) || alert.close || alert.open;
        const entryPrice = livePrice;

        const tipoEntrada = isAnticipated
          ? 'ANTICIPADA (1-2 min antes de :00)'
          : 'CONFIRMADA AUTOMATICA AL DETECTAR LA SEÑAL';
        this.logger.log(
          `🕯️ [H1 NO WICK SEÑAL] ${alert.symbol} ${direction} detectada [${tipoEntrada}]. Precio en vivo: ${entryPrice}.`,
        );

        const openedTrade = await this.openTrade({
          strategy: 'H1_NO_WICK',
          symbol: alert.symbol,
          mercado: alert.mercado || alert.symbol,
          direction,
          entryPrice,
          targetTime: targetTimeSec,
        });

        if (openedTrade) {
          this.logger.log(
            `✅ [H1 NO WICK ENTRADA] ${alert.symbol} ${direction} enviada a MT5 para la vela ${candleEpoch}.`,
          );
          return true;
        }
      }
      return true;
    } catch (err) {
      this.logger.debug(`Error evaluando H1: ${err?.message}`);
      return false;
    }
  }

  private async evaluateDashboardStarsStrategy() {
    try {
      if (!(await this.isH1AutoTradingAllowed())) return;
      if (this.activeTradesMap.size >= this.maxOpenTrades) return;

      const { signals } = await this.weySignalsService.getSignals(4, true);
      const candidates = signals.map((signal) => ({
        stars: Number(signal.estrellas),
        direction: signal.direccion,
        entry: Number(signal.entrada),
        stopLoss: Number(signal.sl),
        mercado: signal.mercado || signal.symbol,
        symbol: signal.symbol,
      }));

      for (const signal of candidates) {
        const symbol = signal.symbol.toUpperCase();
        const direction = signal.direction === 'COMPRA' ? 'BUY' : signal.direction === 'VENTA' ? 'SELL' : null;
        if (!direction || !Number.isFinite(signal.entry) || signal.entry <= 0) continue;

        const hasOpenForSymbol = Array.from(this.activeTradesMap.values()).some(
          (trade) => trade.status === 'OPEN' && this.isSameSymbol(trade.symbol, symbol),
        );
        if (hasOpenForSymbol) continue;

        const cooldownKey = `${symbol}_DASHBOARD_STARS`;
        const lastOpen = this.lastTradeOpenedAt.get(cooldownKey) || 0;
        if (Date.now() - lastOpen < 600_000) continue;

        const openedTrade = await this.openTrade({
          strategy: 'DASHBOARD_STARS',
          symbol,
          mercado: signal.mercado,
          direction,
          entryPrice: signal.entry,
          stopLossPrice: Number.isFinite(signal.stopLoss) && signal.stopLoss > 0 ? signal.stopLoss : null,
        });

        if (openedTrade) {
          this.lastTradeOpenedAt.set(cooldownKey, Date.now());
          this.logger.log(
            `⭐ [DASHBOARD 4★+] WEY ${symbol} ${direction} (${signal.stars}★) enviado a MT5.`,
          );
        }
      }
    } catch (err: any) {
      this.logger.debug(`Error evaluando señales 4★ del dashboard: ${err?.message}`);
    }
  }

  async isUserAuthorizedOnline(): Promise<boolean> {
    const user = await this.usersService.findByEmail(this.h1AutoAuthorizedEmail);
    if (!user?.activeSessionId || !user.lastActiveAt) return false;

    const lastActiveMs = new Date(user.lastActiveAt).getTime();
    if (!Number.isFinite(lastActiveMs)) return false;

    // El frontend envía heartbeat cada 45 segundos mientras la sesión está abierta.
    // Tolerancia estricta de 75 segundos. Si el usuario cierra la app, se bloquea el autotrade.
    return Date.now() - lastActiveMs <= 75 * 1000;
  }

  private async isH1AutoTradingAllowed(): Promise<boolean> {
    return this.isUserAuthorizedOnline();
  }

  private async evaluateScheduledCrashBoomAlerts(minuteKey: number): Promise<void> {
    const evaluations = await this.crashIaService.getSummaryAll();
    const candidates = evaluations
      .filter((item) => item.canBuy || item.canSell);

    if (!candidates.length) {
      this.logger.log('[CRASH/BOOM WHATSAPP] Sin posibles spikes confirmados; no se envia alerta.');
      return;
    }

    await this.evolutionCallService.notifyCrashBoomAlerts(
      candidates,
      `scheduled-${minuteKey}`,
    );
  }

  private async evaluateCrashBoomStrategy() {
    // Índices activos para evaluación automática de estrategias
    const symbols = [
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

    // ── REGLA USUARIO: DOUBLE_WICK_MECHA opera directamente sin importar cuántos trades o símbolos estén abiertos ──
    for (const sym of symbols) {
      const lastOpen = this.lastTradeOpenedAt.get(`${sym}_DOUBLE_WICK`) || 0;
      if (Date.now() - lastOpen < 180_000) continue;

      try {
        const doubleWick = await this.crashIaService.evaluateDoubleWickMecha(sym);
        if (!doubleWick || !doubleWick.isValid) continue;
        if (doubleWick.timeframe !== 'M5' || !doubleWick.autoTrade) continue;

        const patternKey = `${sym}_${doubleWick.patternEpoch}`;
        if (this.doubleWickPatternsExecuted.has(patternKey)) continue;

        const direction = doubleWick.direction;
        const entryPrice = doubleWick.entryPrice;
        const stopLossPrice = doubleWick.stopLossPrice;

        this.logger.log(
          `🕯️ [DOUBLE WICK MECHA] ${sym} ${direction} confirmada. Entrada: ${entryPrice}, SL: ${stopLossPrice}.`,
        );

        const openedTrade = await this.openTrade({
          strategy: 'DOUBLE_WICK_MECHA',
          symbol: sym,
          mercado: doubleWick.mercado || sym,
          direction,
          entryPrice,
          stopLossPrice,
        });

        if (openedTrade) {
          this.lastTradeOpenedAt.set(`${sym}_DOUBLE_WICK`, Date.now());
          this.doubleWickPatternsExecuted.add(patternKey);
        }
      } catch (e) {
        this.logger.debug(`Error evaluando Double Wick Mecha para ${sym}: ${e?.message}`);
      }
    }

    // ── LÍMITE: Máximo 3 trades abiertos simultáneos de estrategia CRASH_BOOM_IA ──
    const cbOpenCount = this.getOpenTradeCountByStrategy('CRASH_BOOM_IA');
    if (cbOpenCount >= this.MAX_TRADES_PER_STRATEGY) {
      this.logger.debug(
        `⛔ [CRASH_BOOM_IA LÍMITE] Ya hay ${cbOpenCount}/${this.MAX_TRADES_PER_STRATEGY} trades CRASH_BOOM_IA abiertos. No se abre nueva entrada.`,
      );
      return;
    }

    for (const sym of symbols) {
      if (this.activeTradesMap.size >= this.maxOpenTrades) break;

      // Revalidar en cada iteración por si se abrió uno durante el bucle
      if (this.getOpenTradeCountByStrategy('CRASH_BOOM_IA') >= this.MAX_TRADES_PER_STRATEGY) break;

      const normSym = this.normalizeSymbol(sym);
      const uniqueActiveSymbols = new Set(
        Array.from(this.activeTradesMap.values())
          .filter((t) => t.status === 'OPEN')
          .map((t) => this.normalizeSymbol(t.symbol)),
      );
      if (this.getActiveSymbolCount() >= this.maxOpenSymbols && !uniqueActiveSymbols.has(normSym)) {
        continue;
      }

      // Regla: No hacer más de 2 trades simultáneos por índice (solo posiciones del bot magic 999888)
      const mt5OpenCount = this.mt5Positions.filter(
        (p) => this.isSameSymbol(p.symbol, sym) && Number(p.magic) === 999888,
      ).length;
      const appOpenCount = Array.from(this.activeTradesMap.values()).filter(
        (t) => this.isSameSymbol(t.symbol, sym) && t.status === 'OPEN',
      ).length;
      if (Math.max(mt5OpenCount, appOpenCount) >= this.maxTradesPerSymbol) continue;

      const lastOpen = this.lastTradeOpenedAt.get(`${sym}_CRASH_BOOM`) || 0;
      if (Date.now() - lastOpen < 180_000) continue;

      try {
        const evalData = await this.crashIaService.evaluateSymbol(sym, 5);
        if (!evalData || !evalData.currentPrice) continue;

        const currentPrice = evalData.currentPrice;
        const vLine = evalData.vLinePrice; // Línea Morada
        const dotted50 = evalData.entryLevel50; // Línea Punteada (50%)
        const boxCeiling = evalData.boxCeiling;
        const boxFloor = evalData.boxFloor;
        const isBoom = evalData.marketType === 'BOOM';

        if (!vLine || vLine <= 0) continue;

        // ── Regla de Entrada Crash & Boom IA ──
        // "debe de hacer el trade si esta entre la linea morada y la punteada.
        // el sl es el area que hay desde la linea morada hasta la linea punteada"
        // REGLA OBLIGATORIA M5: Siempre mirar en TF de 5 minutos antes de decir si la entrada es viable o no.

        const m5IsViable = evalData.m5Viability ? evalData.m5Viability.isViable : true;

        if (!isBoom) {
          // ── CRASH (VENTAS):
          // Zona de Reacción Real: El precio DEBE haber subido al 50% (dotted50) o más,
          // entrando en el área entre la línea punteada (50%) y el techo de la caja (boxCeiling).
          // Jamás vender en la base (vLine) tras un spike porque le falta recorrido para reaccionar.
          const inReactionZone =
            evalData.status === 'EN_ZONA_50' &&
            currentPrice >= dotted50 &&
            currentPrice <= (evalData.stopLossPrice || boxCeiling * 1.05);

          if (!m5IsViable && inReactionZone && evalData.m5Viability) {
            this.logger.debug(
              `⏳ [M5 EN ESPERA] ${sym} en zona general pero en M5 no es viable aún: ${evalData.m5Viability.reason}`,
            );
          }

          if (inReactionZone && evalData.canSell && m5IsViable) {
            // El SL debe quedar fuera de la zona de reacción, por encima del área entre la
            // línea morada (vLine) y la línea punteada (50%). Para 100/200 hay que respetar además
            // el buffer mínimo de la escala del índice.
            const slAreaDist = Math.max(
              Math.abs(dotted50 - vLine),
              Math.abs(boxCeiling - dotted50),
              (evalData.m5CandleHeight || 3.0) * 1.5,
            );
            const topReaction = Math.max(
              boxCeiling,
              vLine,
              dotted50,
              currentPrice,
              evalData.m5Viability?.targetReactionPrice || currentPrice,
            );
            const minSlBuffer = this.getMinSlPoints(sym);
            const stopLossPrice = Number(
              Math.max(topReaction + slAreaDist, dotted50 + slAreaDist, currentPrice + minSlBuffer).toFixed(3),
            );
            const takeProfitPrice: number | null = null;

            this.logger.log(
              `🚀 [CRASH IA ENTRADA] ${sym} VENTA (SELL) confirmada en M5. Precio: ${currentPrice}, Zona Reacción M5: ${evalData.m5Viability?.targetReactionPrice || dotted50}, SL: ${stopLossPrice}`,
            );

            await this.openTrade({
              strategy: 'CRASH_BOOM_IA',
              symbol: sym,
              mercado: evalData.mercado || sym,
              direction: 'SELL',
              entryPrice: currentPrice,
              stopLossPrice,
              takeProfitPrice,
            });

            this.lastTradeOpenedAt.set(`${sym}_CRASH_BOOM`, Date.now());
          }
        } else {
          // ── BOOM (COMPRAS):
          // Zona de Reacción Real: El precio DEBE haber retrocedido al 50% (dotted50) o menos,
          // entrando en el área de descuento entre la línea punteada (50%) y el piso de la caja (boxFloor).
          // Jamás comprar en el pico (vLine) inmediatamente tras un spike porque le falta retroceso.
          // Y en TF M5 debe haber alcanzado el soporte u Order Block donde reacciona.
          const inReactionZone =
            evalData.status === 'EN_ZONA_50' &&
            currentPrice <= dotted50 &&
            currentPrice >= (evalData.stopLossPrice || boxFloor * 0.95);

          if (!m5IsViable && inReactionZone && evalData.m5Viability) {
            this.logger.debug(
              `⏳ [M5 EN ESPERA] ${sym} en zona general pero en M5 no es viable aún: ${evalData.m5Viability.reason}`,
            );
          }

          if (inReactionZone && evalData.canBuy && m5IsViable) {
            // El SL debe quedar fuera de la zona de reacción, por debajo del área entre la
            // línea morada (vLine) y la línea punteada (50%). Para 100/200 hay que respetar
            // además el buffer mínimo de la escala del índice.
            const slAreaDist = Math.max(
              Math.abs(vLine - dotted50),
              Math.abs(dotted50 - boxFloor),
              (evalData.m5CandleHeight || 3.0) * 1.5,
            );
            const baseReaction = Math.min(
              boxFloor,
              vLine,
              dotted50,
              currentPrice,
              evalData.m5Viability?.targetReactionPrice || currentPrice,
            );
            const minSlBuffer = this.getMinSlPoints(sym);
            const stopLossPrice = Number(
              Math.min(baseReaction - slAreaDist, dotted50 - slAreaDist, currentPrice - minSlBuffer).toFixed(3),
            );
            const takeProfitPrice: number | null = null;

            this.logger.log(
              `🚀 [BOOM IA ENTRADA] ${sym} COMPRA (BUY) confirmada en M5. Precio: ${currentPrice}, Zona Reacción M5: ${evalData.m5Viability?.targetReactionPrice || dotted50}, SL: ${stopLossPrice}`,
            );

            await this.openTrade({
              strategy: 'CRASH_BOOM_IA',
              symbol: sym,
              mercado: evalData.mercado || sym,
              direction: 'BUY',
              entryPrice: currentPrice,
              stopLossPrice,
              takeProfitPrice,
            });

            this.lastTradeOpenedAt.set(`${sym}_CRASH_BOOM`, Date.now());
          }
        }
      } catch (e) {
        // Silencioso
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── 5. APERTURA Y CIERRE DE TRADES ─────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  async executeManualTrade(params: {
    symbol: string;
    direction: 'BUY' | 'SELL';
    lot?: number;
    stopLossPrice?: number;
    takeProfitPrice?: number;
  }) {
    const sym = params.symbol.toUpperCase();
    this.logger.log(`👆 [MANUAL TRADE REQUEST] Solicitud manual de orden: ${sym} (${params.direction})`);
    return this.openTrade({
      strategy: 'MANUAL_APP',
      symbol: sym,
      mercado: sym,
      direction: params.direction,
      entryPrice: 0,
      stopLossPrice: params.stopLossPrice || 0,
      takeProfitPrice: params.takeProfitPrice || null,
      lot: params.lot,
    });
  }

  async executeWatchedLevelTrade(params: {
    symbol: string;
    direction: 'BUY' | 'SELL';
    lot?: number;
    entryPrice?: number;
    isBacktesting: boolean;
    levelId?: string;
  }) {
    const sym = params.symbol.toUpperCase();
    const strategy = params.isBacktesting ? 'WATCHED_LEVEL_BT' : 'WATCHED_LEVEL';
    const tag = params.isBacktesting ? 'BACKTESTING' : 'REAL';
    this.logger.log(`🎯 [PUNTO VIGILADO TOCADO - ${tag}] ${sym} (${params.direction}) @ ${params.entryPrice || 'precio actual'}. Enviando a MT5...`);
    return this.openTrade({
      strategy,
      backtesting: params.isBacktesting,
      symbol: sym,
      mercado: sym,
      direction: params.direction,
      entryPrice: params.entryPrice || 0,
      lot: params.lot,
    });
  }

  private async openTrade(params: {
    strategy: 'H1_NO_WICK' | 'CRASH_BOOM_IA' | 'DOUBLE_WICK_MECHA' | 'DASHBOARD_STARS' | 'MANUAL_APP' | 'M5_PLUS' | 'M5_X' | 'WATCHED_LEVEL' | 'WATCHED_LEVEL_BT';
    symbol: string;
    mercado: string;
    direction: 'BUY' | 'SELL';
    entryPrice: number;
    stopLossPrice?: number | null;
    takeProfitPrice?: number | null;
    targetTime?: number | null;
    lot?: number;
    backtesting?: boolean;
    mt5Comment?: string;
  }) {
    // ── REGLA CRÍTICA USUARIO: Si weimarsuber@gmail.com no está logueado en la app, NO hacer autotrade ──
    if (params.strategy !== 'MANUAL_APP') {
      const isUserOnline = await this.isUserAuthorizedOnline();
      if (!isUserOnline) {
        this.logger.warn(
          `⛔ [AUTOTRADE BLOQUEADO] weimarsuber@gmail.com no está activo en la app. No se procesa orden para ${params.symbol} (${params.strategy}).`,
        );
        return null;
      }
    }

    // ── CANDADO DE UNICIDAD POR SÍMBOLO: MÁXIMO 1 OPERACIÓN SIMULTÁNEA POR ÍNDICE ──
    const normSym = this.normalizeSymbol(params.symbol);
    if (params.strategy !== 'MANUAL_APP') {
      if (this.openingSymbolsInFlight.has(normSym)) {
        this.logger.warn(`⛔ [BLOQUEO IN-FLIGHT] Ya se está procesando la apertura de una orden para ${params.symbol}.`);
        return null;
      }

      const hasOpenInApp = Array.from(this.activeTradesMap.values()).some(
        (t) => t.status === 'OPEN' && this.isSameSymbol(t.symbol, params.symbol),
      );
      if (hasOpenInApp) {
        this.logger.warn(`⛔ [BLOQUEO MULTI-TRADE] Ya existe una orden activa en la app para ${params.symbol}. No se permite orden simultánea.`);
        return null;
      }

      const hasOpenInMt5 = (this.mt5Positions || []).some(
        (p) => this.isSameSymbol(p.symbol, params.symbol) && Number(p.magic) === 999888,
      );
      if (hasOpenInMt5) {
        this.logger.warn(`⛔ [BLOQUEO MULTI-TRADE MT5] Ya existe una posición abierta en MT5 para ${params.symbol}. No se permite orden simultánea.`);
        return null;
      }
    }

    this.openingSymbolsInFlight.add(normSym);
    try {
      // ── CANDADO DE SEGURIDAD ESTRICTO PARA SINTÉTICOS DERIV ──
      // Aplica a estrategias automáticas de spikes.
      // WATCHED_LEVEL y MANUAL_APP respetan la dirección configurada por el usuario en el nivel/orden.
      if (
        params.strategy !== 'MANUAL_APP' &&
        params.strategy !== 'WATCHED_LEVEL' &&
        params.strategy !== 'WATCHED_LEVEL_BT'
      ) {
        const symUp = (params.symbol || '').toUpperCase();
        if (symUp.includes('BOOM') && params.direction === 'SELL') {
          this.logger.warn(
            `⛔ [SEGURIDAD] Bloqueada orden de VENTA (SELL) en ${params.symbol}. En índices BOOM SOLO se permite BUY (Compra).`,
          );
          return null;
        }
        if (symUp.includes('CRASH') && params.direction === 'BUY') {
          this.logger.warn(
            `⛔ [SEGURIDAD] Bloqueada orden de COMPRA (BUY) en ${params.symbol}. En índices CRASH SOLO se permite SELL (Venta).`,
          );
          return null;
        }
      }

      // ── PROTECCIÓN ANTI-RACHA NEGATIVA: COOLDOWN GLOBAL POR SÍMBOLO ──
      // Aplica a todas las estrategias automáticas EXCEPTO H1_NO_WICK, MANUAL_APP y WATCHED_LEVEL
      if (
        params.strategy !== 'MANUAL_APP' &&
        params.strategy !== 'H1_NO_WICK' &&
        params.strategy !== 'WATCHED_LEVEL' &&
        params.strategy !== 'WATCHED_LEVEL_BT'
      ) {
        const lastOpen = this.lastSymbolTradeOpenedAt.get(params.symbol) || 0;
        const elapsed = Date.now() - lastOpen;
        const lastResult = this.lastSymbolTradeResult.get(params.symbol);
        // Si el último trade en este símbolo fue una pérdida, aplicar cooldown extendido
        const requiredCooldown = lastResult === 'LOSS'
          ? this.GLOBAL_SYMBOL_COOLDOWN_MS + this.LOSS_PENALTY_COOLDOWN_MS
          : this.GLOBAL_SYMBOL_COOLDOWN_MS;
        if (lastOpen > 0 && elapsed < requiredCooldown) {
          const secsLeft = Math.ceil((requiredCooldown - elapsed) / 1000);
          const minLeft = Math.floor(secsLeft / 60);
          const penalty = lastResult === 'LOSS' ? ` (penalización por pérdida previa)` : '';
          this.logger.warn(
            `🛡️ [COOLDOWN GLOBAL SÍMBOLO] ${params.symbol} (${params.strategy}): Último trade hace ${Math.floor(elapsed / 60000)}m${penalty}. Bloqueando por ${minLeft}m ${secsLeft % 60}s más.`,
          );
          return null;
        }
      }

      // ── BLOQUEO POST-SPIKE (SOLO PARA ESTRATEGIA CRASH_BOOM_IA) ──
      // En CRASH_BOOM_IA (compra/venta en zonas V y retroceso 50%), entrar inmediatamente tras un spike
      // es riesgoso porque le falta retroceso hacia la zona de descuento.
      // Para H1_NO_WICK (macro 1 hora) y DOUBLE_WICK_MECHA (M5 dos velas con mecha) NO aplica este bloqueo.
      if (params.strategy === 'CRASH_BOOM_IA') {
        const POST_SPIKE_BLOCK_MS = 5 * 60 * 1000; // 5 minutos de bloqueo post-spike
        const lastSpike = this.lastSpikeAt.get(params.symbol) || 0;
        const msSinceSpike = Date.now() - lastSpike;
        if (lastSpike > 0 && msSinceSpike < POST_SPIKE_BLOCK_MS) {
          const secsLeft = Math.ceil((POST_SPIKE_BLOCK_MS - msSinceSpike) / 1000);
          this.logger.warn(
            `⚡ [BLOQUEO POST-SPIKE] ${params.symbol} (${params.strategy}): spike detectado hace ${Math.floor(msSinceSpike / 1000)}s. Bloqueando entrada por ${secsLeft}s más.`,
          );
          return null;
        }
      }

      // ── FILTRO DE TENDENCIA MACRO (EMA 20 en M15): NO OPERAR CONTRA LA TENDENCIA ──
      // Si el precio está en tendencia alcista (por encima de EMA20) y queremos SELL → bloquear.
      // Si el precio está en tendencia bajista (por debajo de EMA20) y queremos BUY → bloquear.
      // Aplica a todas las estrategias automáticas menos H1_NO_WICK (señal horaria) y MANUAL_APP.
      if (params.strategy !== 'MANUAL_APP' && params.strategy !== 'H1_NO_WICK') {
        const trendCheck = await this.isTrendFavorable(params.symbol, params.direction);
        if (!trendCheck.favorable) {
          this.logger.warn(
            `📉 [FILTRO TENDENCIA M15] ${params.symbol} (${params.strategy}): ${trendCheck.reason}`,
          );
          return null;
        }
        this.logger.debug(`✅ [TENDENCIA OK] ${params.symbol}: ${trendCheck.reason}`);
      }

      // ── RETROALIMENTACIÓN ADAPTATIVA IA (FILTRO HORARIO Y CIRCUIT BREAKER) ──
      // H1_NO_WICK es una señal horaria directa. No debe quedar bloqueada por
      // el filtro adaptativo de rendimiento usado por las estrategias frecuentes.
      if (params.strategy !== 'MANUAL_APP' && params.strategy !== 'H1_NO_WICK') {
        const adaptiveCheck = await this.statsService.canTradeAdaptive(params.symbol, params.strategy);
        if (!adaptiveCheck.allowed) {
          this.logger.warn(`🛡️ [RETROALIMENTACIÓN IA BLOQUEADA] ${params.symbol}: ${adaptiveCheck.reason}`);
          return null;
        }
      }

      const lot = (params as any).lot || this.getDefaultLotForSymbol(params.symbol);
      const maxLossUsd = this.getMaxSlUsd(params.symbol);
      const slDistPoints = Number((maxLossUsd / lot).toFixed(3));

      // Usar precio real de tick más reciente si está disponible para evitar desfases con velas antiguas
      const livePrice = this.lastTickPrice.get(params.symbol);
      if (livePrice && livePrice > 0) {
        params.entryPrice = livePrice;
      }

      // Calcular SL monetario estricto a partir del precio de entrada real
      if (!params.stopLossPrice || params.strategy !== 'MANUAL_APP') {
        params.stopLossPrice = params.direction === 'BUY'
          ? Number((params.entryPrice - slDistPoints).toFixed(3))
          : Number((params.entryPrice + slDistPoints).toFixed(3));
      }

      const now = new Date();
      const hourOfDay = now.getHours();
      const dayOfWeek = now.getDay();
      const session = this.statsService.getSessionFromHour(hourOfDay);

      const isBt = params.backtesting === true;
      const trade = this.tradeRepo.create({
        strategy: params.strategy,
        backtesting: isBt,
        symbol: params.symbol,
        mercado: params.mercado,
        direction: params.direction,
        entryPrice: params.entryPrice,
        currentPrice: params.entryPrice,
        stopLossPrice: params.stopLossPrice || null,
        takeProfitPrice: params.takeProfitPrice || null,
        entryTime: Math.floor(Date.now() / 1000),
        targetTime: params.targetTime || null,
        status: 'OPEN',
        pnlPoints: 0,
        maxProfitPoints: 0,
        maxProfitUsd: 0,
        hadSpike: false,
        spikeCount: 0,
        pnlPercent: 0,
        lot,
        hourOfDay,
        dayOfWeek,
        session,
      });

      try {
        const saved = await this.tradeRepo.save(trade);
        trade.id = saved.id;
      } catch (e) {
        this.logger.debug(`Guardado en BD pendiente: ${e?.message}`);
        if (!trade.id) {
          trade.id = randomUUID();
        }
      }

      this.activeTradesMap.set(trade.id, trade);

      // Registrar incremento de trade para este símbolo
      const currentCount = this.tradesCountPerSymbol.get(params.symbol) || 0;
      this.tradesCountPerSymbol.set(params.symbol, currentCount + 1);

      // Actualizar cooldown global por símbolo (aplica a todas las estrategias automáticas)
      if (params.strategy !== 'MANUAL_APP') {
        this.lastSymbolTradeOpenedAt.set(params.symbol, Date.now());
      }

      // Identificación clara para MT5 (máx 31 caracteres para el campo comment de MT5)
      let mt5Comment = params.mt5Comment || trade.strategy;
      if (params.strategy === 'WATCHED_LEVEL') {
        mt5Comment = 'WL_REAL';
      } else if (params.strategy === 'WATCHED_LEVEL_BT') {
        mt5Comment = 'WL_BT';
      } else if (params.strategy === 'H1_NO_WICK') {
        mt5Comment = 'H1_NO_WICK';
      }

      const stratLabel = trade.strategy === 'WATCHED_LEVEL_BT'
        ? 'PUNTO VIGILADO (BACKTESTING)'
        : trade.strategy === 'WATCHED_LEVEL'
        ? 'PUNTO VIGILADO (REAL)'
        : trade.strategy;

      this.logger.log(
        `🚀 [TRADE OPENED - ${stratLabel}] ${trade.symbol} (${trade.direction}) @ ${trade.entryPrice}. Backtesting: ${isBt ? 'SÍ' : 'NO'}. Lot: ${lot}. SL: ${trade.stopLossPrice} (Límite: -$${maxLossUsd} USD / 4 min). Sesión: ${session} (${hourOfDay}:00). (Total hoy: ${currentCount + 1}/${this.maxTradesPerSymbol})`,
      );

      // ── Enviar orden al puente de MetaTrader 5 con el Stop Loss de precio calculado ──
      await this.sendMt5Command({
        id: `cmd_${randomUUID().slice(0, 8)}`,
        tradeId: trade.id,
        action: 'OPEN',
        symbol: this.toMt5Symbol(trade.symbol),
        direction: trade.direction,
        entryPrice: trade.entryPrice,
        stopLossPrice: trade.stopLossPrice,
        takeProfitPrice: trade.takeProfitPrice,
        lot: trade.lot || this.getDefaultLotForSymbol(trade.symbol),
        comment: mt5Comment,
        status: 'PENDING',
      });

      return trade;
    } finally {
      this.openingSymbolsInFlight.delete(normSym);
    }
  }

  async closeTrade(id: string, reason: string, currentExitPrice?: number) {
    const trade = this.activeTradesMap.get(id);
    if (!trade) return null;

    this.tradeLastSpikeTime.delete(id);

    trade.status = 'CLOSED';
    trade.exitTime = Math.floor(Date.now() / 1000);
    trade.exitPrice = currentExitPrice || trade.currentPrice || trade.entryPrice;
    trade.exitReason = reason;

    if (trade.direction === 'BUY') {
      trade.pnlPoints = Number((trade.exitPrice - trade.entryPrice).toFixed(3));
    } else {
      trade.pnlPoints = Number((trade.entryPrice - trade.exitPrice).toFixed(3));
    }
    trade.pnlPercent = Number(
      ((trade.pnlPoints / trade.entryPrice) * 100).toFixed(2),
    );

    const durationSec = Math.max(0, trade.exitTime - Number(trade.entryTime || trade.exitTime));
    trade.durationSec = durationSec;

    if (reason === 'MT5_TIMEOUT_NO_FILL') {
      trade.pnlPoints = 0;
      trade.pnlPercent = 0;
      trade.pnlUsd = 0;
      trade.result = 'BREAKEVEN';
      // Liberar candados y cooldowns para no perjudicar la siguiente vela H1
      this.lastTradeOpenedAt.delete(`${trade.symbol}_H1`);
      for (const key of Array.from(this.h1CandlesExecuted)) {
        if (key.startsWith(`${trade.symbol}_`)) {
          this.h1CandlesExecuted.delete(key);
        }
      }
    } else {
      const lot = trade.lot || this.getDefaultLotForSymbol(trade.symbol);
      trade.pnlUsd = Number((trade.pnlPoints * lot).toFixed(2));
      trade.result = trade.pnlUsd > 0.05 ? 'WIN' : trade.pnlUsd < -0.05 ? 'LOSS' : 'BREAKEVEN';
    }

    // ── Registrar resultado en memoria para el cooldown anti-racha del símbolo ──
    if (trade.result && trade.strategy !== 'MANUAL_APP') {
      this.lastSymbolTradeResult.set(trade.symbol, trade.result);
      if (trade.result === 'LOSS') {
        this.logger.warn(
          `⚠️ [PÉRDIDA REGISTRADA] ${trade.symbol} (${trade.strategy}): Cooldown extendido a ${(this.GLOBAL_SYMBOL_COOLDOWN_MS + this.LOSS_PENALTY_COOLDOWN_MS) / 60000} min para evitar re-entrada inmediata.`,
        );
      }
    }

    this.activeTradesMap.delete(id);

    try {
      await this.tradeRepo.update(id, {
        status: 'CLOSED',
        exitTime: trade.exitTime,
        exitPrice: trade.exitPrice,
        exitReason: trade.exitReason,
        pnlPoints: trade.pnlPoints,
        pnlPercent: trade.pnlPercent,
        pnlUsd: trade.pnlUsd,
        durationSec: trade.durationSec,
        result: trade.result,
        hadSpike: trade.hadSpike === true,
        spikeCount: trade.spikeCount || 0,
        maxProfitPoints: trade.maxProfitPoints || 0,
        maxProfitUsd: trade.maxProfitUsd || 0,
      });
    } catch (e) {
      this.logger.debug(`Actualización de cierre en BD: ${e?.message}`);
    }

    if (
      trade.strategy === 'MANUAL_APP' ||
      trade.strategy === 'WATCHED_LEVEL' ||
      trade.strategy === 'WATCHED_LEVEL_BT'
    ) {
      this.events.emit('watched_level.trade_closed', trade);
    }


    this.logger.log(
      `🏁 [TRADE CLOSED] ${trade.symbol} (${trade.direction}) cerrado por [${reason}]. PnL: ${trade.pnlPoints} pts.`,
    );

    // ── Enviar orden de cierre al puente de MetaTrader 5 (buscando ticket explícito o por coincidencia) ──
    if (reason !== 'MT5_CLOSED') {
      let ticketToClose = trade.mt5Ticket ? Number(trade.mt5Ticket) : 0;
      if (!ticketToClose) {
        const normSym = (s: string) => (s || '').toUpperCase().replace(/[\s_]/g, '').replace('INDEX', '');
        const found = this.mt5Positions.find(
          (p) =>
            normSym(p.symbol) === normSym(trade.symbol) &&
            Number(p.magic) === 999888 &&
            p.type === trade.direction,
        );
        if (found) ticketToClose = Number(found.ticket);
      }
      if (ticketToClose > 0) {
        await this.sendMt5Command({
          id: `cmd_close_${randomUUID().slice(0, 8)}`,
          tradeId: trade.id,
          action: 'CLOSE',
          ticket: ticketToClose,
          symbol: trade.symbol,
          reason,
          status: 'PENDING',
        });
      }
    }

    return trade;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── 6. PUENTE DE COMUNICACIÓN CON METATRADER 5 ─────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  getPendingMt5Commands(): any[] {
    const now = Date.now();
    const list = this.pendingMt5Commands.filter((cmd) => {
      if (cmd?.action !== 'OPEN') return true;

      const trade = this.activeTradesMap.get(cmd.tradeId);
      const queuedAt = Number(cmd.queuedAt || 0);
      const isExpired = queuedAt > 0 && now - queuedAt > this.mt5OpenCommandMaxAgeMs;
      const isInactive = !trade || trade.status !== 'OPEN' || Boolean(trade.mt5Ticket);

      if (isExpired || isInactive) {
        this.logger.warn(
          `[MT5 BRIDGE] Comando OPEN descartado por vencido o inactivo (${cmd.symbol || 'sin simbolo'}, ${cmd.tradeId || 'sin tradeId'}).`,
        );
        return false;
      }

      return true;
    });
    this.pendingMt5Commands = [];
    return list;
  }

  async handleMt5Feedback(feedbackData: any) {
    if (typeof feedbackData === 'string') {
      const rawObjects = feedbackData.match(/\{[^{}]+\}/g) || [];
      for (const raw of rawObjects) {
        try {
          const sanitized = raw.replace(/"time":([0-9.]+ [0-9:]+)/, '"time":"$1"');
          const fb = JSON.parse(sanitized);
          await this.processSingleFeedback(fb);
        } catch {}
      }
    } else if (Array.isArray(feedbackData)) {
      for (const fb of feedbackData) {
        await this.processSingleFeedback(fb);
      }
    } else if (feedbackData && typeof feedbackData === 'object') {
      await this.processSingleFeedback(feedbackData);
    }
    return { ok: true };
  }

  private async processSingleFeedback(fb: any) {
    if (fb && fb.tradeId && fb.ticket) {
      const trade = this.activeTradesMap.get(fb.tradeId);
      if (trade && !trade.mt5Ticket) {
        trade.mt5Ticket = String(fb.ticket);
        await this.tradeRepo
          .update(trade.id, { mt5Ticket: trade.mt5Ticket })
          .catch(() => {});
        this.logger.log(
          `🎯 [MT5 BRIDGE] ¡Operación confirmada en MetaTrader 5! Ticket #${fb.ticket} para ${trade.symbol}`,
        );
      }
    }
  }

  async handleMt5Positions(positions: any[]) {
    if (Array.isArray(positions)) {
      this.mt5Positions = positions;
      this.lastMt5SyncAt = Date.now();
      await this.processMt5PositionsSync(positions);
    }
    return { ok: true, count: this.mt5Positions.length };
  }

  async handleMt5History(deals: any[]) {
    if (Array.isArray(deals)) {
      await this.processMt5HistorySync(deals);
    }
    return { ok: true };
  }

  private async sendMt5Command(cmd: any) {
    // ── REGLA: Solo enviar aperturas a MT5 si el usuario autorizado (weimarsuber@gmail.com) está conectado ──
    if (cmd.action === 'OPEN') {
      const userOnline = await this.isUserAuthorizedOnline();
      if (!userOnline) {
        this.logger.warn(
          `🚫 [MT5 BLOQUEADO] Comando OPEN para ${cmd.symbol || ''} NO enviado: el usuario autorizado (${this.h1AutoAuthorizedEmail}) no está conectado o su sesión expiró.`,
        );
        return;
      }
    }

    const command = {
      ...cmd,
      queuedAt: Number(cmd?.queuedAt) || Date.now(),
    };

    // Si la carpeta de MT5 no existe en este servidor (ej: VPS Linux), el comando se despacha por bridge HTTP
    if (!fs.existsSync(this.mt5FilesDir)) {
      if (command.action === 'OPEN' && command.tradeId) {
        // Deduplicar: solo 1 comando OPEN por tradeId (evita doble envío en reintentos)
        const alreadyQueued = this.pendingMt5Commands.some(
          (pending) => pending.action === 'OPEN' && pending.tradeId === command.tradeId,
        );
        if (alreadyQueued) {
          this.logger.warn(
            `[MT5 BRIDGE] Comando OPEN duplicado ignorado para tradeId=${command.tradeId} (${cmd.symbol}).`,
          );
          return;
        }
      }
      this.pendingMt5Commands.push(command);
      this.logger.debug(
        `[MT5 BRIDGE] Comando ${cmd.action} encolado para bridge HTTP (${cmd.symbol} ${cmd.direction || ''}).`,
      );
      return;
    }

    let attempts = 3;
    while (attempts > 0) {
      try {
        const line = JSON.stringify(command) + '\n';
        fs.appendFileSync(this.mt5CommandsFile, line, 'utf8');

        this.logger.log(
          `📡 [MT5 BRIDGE] Comando ${cmd.action} enviado a MetaTrader 5 (${cmd.symbol} ${cmd.direction || ''})`,
        );
        break;
      } catch (e) {
        attempts--;
        if (attempts === 0) {
          this.logger.warn(`⚠️ Error escribiendo comando MT5 tras 3 intentos: ${e?.message}`);
        } else {
          // Breve espera antes de reintentar por si el archivo estaba bloqueado por MT5
          const waitTill = Date.now() + 50;
          while (Date.now() < waitTill) {}
        }
      }
    }
  }

  private async pollMt5Feedback() {
    try {
      // 1. Sincronización de posiciones abiertas reales desde MetaTrader 5 (si archivo local existe)
      if (fs.existsSync(this.mt5PositionsFile)) {
        try {
          const positionsStat = fs.statSync(this.mt5PositionsFile);
          const positionsAreFresh = Date.now() - positionsStat.mtimeMs < this.mt5BridgeTimeoutMs;
          const posContent = positionsAreFresh
            ? fs.readFileSync(this.mt5PositionsFile, 'utf8')
            : '';
          if (positionsAreFresh && posContent && posContent.trim().startsWith('[')) {
            const rawPositions = JSON.parse(posContent);
            if (Array.isArray(rawPositions)) {
              this.mt5Positions = rawPositions;
              this.lastMt5SyncAt = Date.now();
              await this.processMt5PositionsSync(rawPositions);
            }
          }
        } catch (errPos) {}
      }

      // 2. Procesar confirmación de tickets enviados (si archivo local existe)
      if (fs.existsSync(this.mt5FeedbackFile)) {
        const content = fs.readFileSync(this.mt5FeedbackFile, 'utf8');
        await this.handleMt5Feedback(content);
      }

      // 3. Limpieza automática y reintento activo de órdenes sin ticket MT5
      const nowSec = Math.floor(Date.now() / 1000);
      for (const trade of this.activeTradesMap.values()) {
        if (trade.status === 'OPEN' && !trade.mt5Ticket) {
          const age = nowSec - (Number(trade.entryTime) || nowSec);
          // Reintento automático a los 3s y 8s si el comando se perdió o MT5 estaba ocupado
          if (age >= 3 && age <= 20 && (!trade['lastRetrySec'] || nowSec - trade['lastRetrySec'] >= 5)) {
            trade['lastRetrySec'] = nowSec;
            this.logger.warn(`🔁 [MT5 RETRY] Reenviando orden OPEN a MT5 para ${trade.symbol} (a los ${age}s sin confirmación)...`);
            await this.sendMt5Command({
              id: `cmd_retry_${trade.id.slice(0, 8)}_${nowSec}`,
              tradeId: trade.id,
              action: 'OPEN',
              symbol: trade.symbol,
              direction: trade.direction,
              entryPrice: trade.entryPrice,
              stopLossPrice: trade.stopLossPrice,
              takeProfitPrice: trade.takeProfitPrice,
              lot: trade.lot || this.getDefaultLotForSymbol(trade.symbol),
              comment: trade.strategy,
              status: 'PENDING',
            });
          }
          if (age > 60) {
            this.logger.warn(
              `⏱️ [MT5 TIMEOUT] Trade ${trade.symbol} (${trade.id}) lleva ${age}s sin confirmación de MT5. Cancelando orden fantasma para liberar cupo.`,
            );
            await this.closeTrade(trade.id, 'MT5_TIMEOUT_NO_FILL');
          }
        }
      }

      // 4. Sincronización continua de HISTORIAL REAL de transacciones cerradas (si archivo local existe)
      if (fs.existsSync(this.mt5HistoryFile)) {
        try {
          const histContent = fs.readFileSync(this.mt5HistoryFile, 'utf8');
          if (histContent && histContent.trim().startsWith('[')) {
            const rawDeals = JSON.parse(histContent);
            if (Array.isArray(rawDeals)) {
              await this.processMt5HistorySync(rawDeals);
            }
          }
        } catch (errHist) {
          this.logger.debug(`Error procesando mt5HistoryFile: ${errHist?.message}`);
        }
      }
    } catch (e) {}
  }

  private async processMt5PositionsSync(rawPositions: any[]) {
    try {
      const openTicketsSet = new Set(
        rawPositions.map((p) => String(p.ticket)),
      );

      const normSym = (str: string) =>
        (str || '').toUpperCase().replace(/\s+/g, '').replace('INDEX', '').replace(/N$/, '');

      // Vincular automáticamente trades locales con posiciones de MT5 (solo magic 999888).
      const assignedTickets = new Set(
        Array.from(this.activeTradesMap.values())
          .map((t) => String(t.mt5Ticket))
          .filter(Boolean),
      );

      for (const trade of this.activeTradesMap.values()) {
        if (!trade.mt5Ticket) {
          const targetSym = normSym(trade.symbol);
          const mt5Match = rawPositions.find(
            (p) =>
              normSym(p.symbol) === targetSym &&
              Number(p.magic) === 999888 &&
              p.type === trade.direction &&
              !assignedTickets.has(String(p.ticket)),
          );
          if (mt5Match) {
            trade.mt5Ticket = String(mt5Match.ticket);
            trade.lot = Number(mt5Match.volume) || trade.lot || 0.5;
            assignedTickets.add(String(mt5Match.ticket));
            this.tradeRepo
              .update(trade.id, { mt5Ticket: trade.mt5Ticket, lot: trade.lot })
              .catch(() => {});
            this.logger.log(
              `🔗 [MT5 SYNC] Trade ${trade.symbol} vinculado con éxito a Ticket #${mt5Match.ticket} de MT5 (Vol: ${trade.lot}, Magic: ${mt5Match.magic})`,
            );
          }
        }

        // Actualizar PnL y Precio actual directamente desde MT5
        if (trade.mt5Ticket) {
          const mt5Pos = rawPositions.find((p) => String(p.ticket) === String(trade.mt5Ticket));
          if (mt5Pos) {
            trade.currentPrice = mt5Pos.currentPrice;
            trade.pnlPoints = mt5Pos.profit;
            trade.pnlUsd = mt5Pos.profit; // Profit exacto en USD de MetaTrader

            // Rastrear ganancia máxima alcanzada en MT5 en USD
            if (mt5Pos.profit > (trade.maxProfitPoints || 0)) {
              trade.maxProfitPoints = mt5Pos.profit;
            }

            // Si en MT5 el trade alcanza ganancia de spike (>= $1.50 USD), registrar el spike
            if (mt5Pos.profit >= 1.50) {
              const prevTradeSpike = this.tradeLastSpikeTime.get(trade.id) || 0;
              if (!prevTradeSpike || (Date.now() - prevTradeSpike > 15_000 && mt5Pos.profit > (trade.maxProfitPoints || 0))) {
                this.tradeLastSpikeTime.set(trade.id, Date.now());
                this.lastSpikeAt.set(trade.symbol, Date.now());
                this.logger.log(
                  `⚡ [SPIKE CONFIRMADO POR MT5] ${trade.symbol} (${trade.strategy}): Profit MT5 +$${mt5Pos.profit.toFixed(2)} USD. Iniciando/reiniciando espera obligatoria de 5 minutos tras el spike.`,
                );
              }
            }

            // ── REGLA: SOLO PROTEGER EL PROFIT SI EL PICO ALCANZÓ AL MENOS $6.00 USD ──
            // EXCEPCIÓN CRÍTICA: H1_NO_WICK NUNCA se cierra por trailing de pico.
            if (trade.strategy !== 'H1_NO_WICK' && (trade.maxProfitPoints || 0) >= 6.0) {
              const protectedFloor = Number((trade.maxProfitPoints * 0.70).toFixed(2));
              if (mt5Pos.profit <= protectedFloor) {
                this.logger.log(
                  `🛡️ [PROTECCIÓN 70% MT5] ${trade.symbol} (Ticket #${trade.mt5Ticket}) pico de +$${trade.maxProfitPoints.toFixed(2)} USD. Protegiendo 70% al retroceder a +$${mt5Pos.profit.toFixed(2)} USD (piso 70%: +$${protectedFloor} USD). Cerrando en ganancia.`,
                );
                await this.closeTrade(
                  trade.id,
                  'PROTECT_70_PERCENT_PROFIT',
                  trade.currentPrice || trade.entryPrice,
                );
                continue;
              }
            }
          }
        }

        // Sincronizar: Si un trade abierto de la app ya no está en MT5, marcarlo como CERRADO.
        if (trade.mt5Ticket && !openTicketsSet.has(String(trade.mt5Ticket))) {
          this.logger.log(
            `🏁 [MT5 SYNC] Posición #${trade.mt5Ticket} (${trade.symbol}) ya no existe en MetaTrader 5. Sincronizando estado CERRADO en la App.`,
          );
          await this.closeTrade(
            trade.id,
            'MT5_CLOSED',
            trade.currentPrice || trade.entryPrice,
          );
        }
      }

      // ── RASTREO Y PROTECCIÓN GLOBAL DEL 70% DEL PROFIT ──
      for (const pos of rawPositions) {
        const tKey = String(pos.ticket);

        // Excluir posiciones de H1_NO_WICK (se gestionan estrictamente con espera obligatoria de 5 min tras spike)
        const tradeForPos = Array.from(this.activeTradesMap.values()).find(
          (t) => String(t.mt5Ticket) === tKey || tKey.includes(String(t.mt5Ticket)),
        );
        if (tradeForPos && tradeForPos.strategy === 'H1_NO_WICK') {
          continue;
        }
        const posComment = String(pos.comment || '');
        if (posComment.includes('H1')) {
          continue;
        }

        const curProfit = Number(pos.profit) || 0;
        const prevMax = this.mt5TrackedMaxProfit.get(tKey) || 0;

        if (curProfit > prevMax) {
          this.mt5TrackedMaxProfit.set(tKey, curProfit);
        }

        const peak = this.mt5TrackedMaxProfit.get(tKey) || 0;
        // Solo proteger si el beneficio ya alcanzó al menos 6.00 USD
        if (peak >= 6.0) {
          const floor70 = Number((peak * 0.70).toFixed(2));
          if (curProfit <= floor70) {
            this.logger.log(
              `🛡️ [PROTECCIÓN 70% MT5] Posición #${tKey} (${pos.symbol}) pico de +$${peak.toFixed(2)} USD. Retroceso a +$${curProfit.toFixed(2)} USD (piso 70%: +$${floor70} USD). Enviando orden de cierre directo a MT5.`,
            );
            await this.sendMt5Command({
              id: `cmd_protect_${randomUUID().slice(0, 8)}`,
              action: 'CLOSE',
              ticket: Number(pos.ticket),
              symbol: pos.symbol,
              reason: 'PROTECT_70_PERCENT_PROFIT',
              status: 'PENDING',
            });
            this.mt5TrackedMaxProfit.delete(tKey);
          }
        }
      }

      // Limpiar tickets antiguos de mt5TrackedMaxProfit que ya se hayan cerrado en MT5
      for (const trackedTicket of this.mt5TrackedMaxProfit.keys()) {
        if (!openTicketsSet.has(trackedTicket)) {
          this.mt5TrackedMaxProfit.delete(trackedTicket);
        }
      }
    } catch (errPos) {
      this.logger.debug(`Error procesando posiciones MT5: ${errPos?.message}`);
    }
  }

  private async processMt5HistorySync(rawDeals: any[]) {
    try {
      for (const deal of rawDeals) {
        const dealTicketStr = String(deal.positionId || deal.orderTicket || deal.dealTicket);
        const existing = await this.tradeRepo.findOne({
          where: [
            { mt5Ticket: dealTicketStr },
            { mt5Ticket: String(deal.dealTicket) },
            { mt5Ticket: String(deal.orderTicket) },
          ],
        });

        const pnlUsd = Number((deal.netProfit !== undefined ? deal.netProfit : deal.profit).toFixed(2));
        const result = pnlUsd > 0.05 ? 'WIN' : pnlUsd < -0.05 ? 'LOSS' : 'BREAKEVEN';

        if (existing) {
          if (existing.status !== 'CLOSED' || Math.abs((existing.pnlUsd || 0) - pnlUsd) > 0.01) {
            await this.tradeRepo.update(existing.id, {
              status: 'CLOSED',
              exitPrice: deal.closePrice,
              exitTime: deal.closeTime,
              exitReason: existing.exitReason || 'MT5_CLOSED',
              pnlUsd,
              pnlPoints: deal.direction === 'BUY'
                ? Number((deal.closePrice - existing.entryPrice).toFixed(3))
                : Number((existing.entryPrice - deal.closePrice).toFixed(3)),
              lot: deal.volume,
              result,
              hadSpike: existing.hadSpike === true,
              spikeCount: existing.spikeCount || 0,
              maxProfitPoints: existing.maxProfitPoints || 0,
              maxProfitUsd: existing.maxProfitUsd || 0,
            });
            this.activeTradesMap.delete(existing.id);
          }
          if (
            existing.strategy === 'MANUAL_APP' ||
            existing.strategy === 'WATCHED_LEVEL' ||
            existing.strategy === 'WATCHED_LEVEL_BT'
          ) {
            this.events.emit('watched_level.trade_closed', {
              ...existing,
              status: 'CLOSED',
              exitPrice: deal.closePrice,
              exitTime: deal.closeTime,
              exitReason: existing.exitReason || 'MT5_CLOSED',
            });
          }
        } else {
          const sym = this.normalizeSymbol(deal.symbol);
          const openDate = new Date(Number(deal.openTime) * 1000);
          const hourOfDay = openDate.getHours();
          const dayOfWeek = openDate.getDay();
          const session = this.statsService.getSessionFromHour(hourOfDay);

          const newTrade = this.tradeRepo.create({
            strategy: Number(deal.magic) === 999888 ? 'CRASH_BOOM_IA' : 'MANUAL_APP',
            symbol: sym,
            mercado: deal.symbol,
            direction: deal.direction,
            entryPrice: deal.openPrice,
            currentPrice: deal.closePrice,
            exitPrice: deal.closePrice,
            entryTime: deal.openTime,
            exitTime: deal.closeTime,
            status: 'CLOSED',
            exitReason: 'MT5_CLOSED',
            mt5Ticket: dealTicketStr,
            pnlPoints: deal.direction === 'BUY'
              ? Number((deal.closePrice - deal.openPrice).toFixed(3))
              : Number((deal.openPrice - deal.closePrice).toFixed(3)),
            pnlPercent: deal.openPrice > 0
              ? Number((((deal.closePrice - deal.openPrice) / deal.openPrice) * 100).toFixed(2))
              : 0,
            pnlUsd,
            lot: deal.volume,
            durationSec: Math.max(0, deal.closeTime - deal.openTime),
            hourOfDay,
            dayOfWeek,
            session,
            result,
          });
          await this.tradeRepo.save(newTrade);
        }
      }
    } catch (errHist) {
      this.logger.debug(`Error procesando historial MT5: ${errHist?.message}`);
    }
  }


  async clearAllPhantomTrades() {
    let closedCount = 0;
    for (const trade of this.activeTradesMap.values()) {
      if (trade.status === 'OPEN' && !trade.mt5Ticket) {
        await this.closeTrade(trade.id, 'MANUAL_PHANTOM_CLEANUP');
        closedCount++;
      }
    }
    return { closedCount, activeCount: this.activeTradesMap.size };
  }

  getMt5Status() {
    const isConnected = this.isMt5BridgeConnected();
    return {
      connected: isConnected,
      lastSyncAt: this.lastMt5SyncAt,
      positionsCount: this.mt5Positions.length,
      positions: this.mt5Positions,
      tradesCountPerSymbol: Object.fromEntries(this.tradesCountPerSymbol.entries()),
    };
  }

  private isMt5BridgeConnected(): boolean {
    return this.lastMt5SyncAt > 0 && Date.now() - this.lastMt5SyncAt < this.mt5BridgeTimeoutMs;
  }

  isSameSymbol(symA: string, symB: string): boolean {
    const norm = (s: string) =>
      (s || '')
        .toUpperCase()
        .replace(/\s+/g, '')
        .replace('INDEX', '')
        .replace(/N$/, '');
    return norm(symA) === norm(symB);
  }

  getDefaultLotForSymbol(sym: string): number {
    const s = (sym || '').toUpperCase().replace(/\s+/g, '');

    if (
      s.includes('CRASH600') || s.includes('C600') ||
      s.includes('CRASH900') || s.includes('C900') ||
      s.includes('BOOM1000') || s.includes('B1000')
    ) {
      return 0.50;
    }

    return 1.00;
  }

  getMinProfitPointsForProtection(sym: string): number {
    const s = (sym || '').toUpperCase();
    if (s.includes('100') && !s.includes('1000')) return 1.5;
    if (s.includes('200')) return 1.5;
    if (s.includes('300')) return 2.5;
    if (s.includes('500')) return 3.5;
    if (s.includes('600')) return 4.5;
    if (s.includes('900')) return 6.0;
    if (s.includes('1000')) return 7.0;
    return 3.0;
  }
}
