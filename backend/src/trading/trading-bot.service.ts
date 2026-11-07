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
import { EaWeySMCService } from '../strategies/ea-wey-smc.service';
import { SmcSyntheticsService } from '../strategies/smc-synthetics.service';
import { TradingStatsService } from './trading-stats.service';
import { UsersService } from '../users/users.service';
import { EvolutionCallService } from '../notifications/evolution-call.service';
import { WeySignalsService } from '../apex-signals/wey-signals.service';
import { CandlesService } from '../candles/candles.service';

@Injectable()
export class TradingBotService implements OnModuleInit {
  private readonly logger = new Logger(TradingBotService.name);

  // Configuraciones del Bot (SMC Pro y todos los Crash/Boom con máx 3 concurrentes, sin entradas en XAUUSD)
  private h1AutoEnabled = false;
  private dashboardStarsAutoEnabled = false;
  private crashBoomAutoEnabled = true;
  private m5PlusAutoEnabled = false; // M5++ auto-trading (desactivado)
  private m5XAutoEnabled = false;
  private smcProAutoEnabled = true;  // Estrategia SMC Pro activa
  private maxOpenTrades = 3;
  private maxOpenSymbols = 3;
  private maxCrashBoomTrades = 3; // Máximo 3 concurrentes entre Crash y Boom
  private maxXauusdTrades = 0;    // 0 concurrentes para XAUUSD (Oro bloqueado)
  private maxOtherTrades = 0;     // 0 concurrentes para Forex y otros sintéticos (restringidos por usuario)
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
  // Cooldown de 10 minutos para XAUUSD tras salida en Stop Loss
  private readonly GOLD_SL_COOLDOWN_MS = 10 * 60 * 1000;
  private lastGoldSlExitAt = 0;

  // ── REGLA USUARIO: Cooldown de 30 minutos tras salir en Stop Loss en el mismo índice ──
  private readonly SYMBOL_SL_COOLDOWN_MS = 30 * 60 * 1000;
  private lastSymbolSlExitAt = new Map<string, number>();

  // ── REGLA USUARIO: Pausa de 1 hora si al transcurrir una hora se está en déficit o pérdida ──
  private hourlyDeficitPauseUntil = 0;

  // ── Detección de Spikes para H1_NO_WICK ──
  // lastSpikeAt[symbol]: timestamp (ms) del último spike detectado por símbolo
  // tradeLastSpikeTime[tradeId]: timestamp (ms) del último spike detectado para este trade específico
  // lastTickPrice[symbol]: último precio visto en ticks, para calcular el delta
  private lastSpikeAt = new Map<string, number>();
  private tradeLastSpikeTime = new Map<string, number>();
  private lastTickPrice = new Map<string, number>();

  // ── REGLA USUARIO: Retroceso mínimo al 50% del Spike antes de entrar ──
  // Guarda el origen, extremo y punto medio (50%) del último spike ocurrido
  private lastSpikeDetails = new Map<
    string,
    {
      timestamp: number;
      originPrice: number;
      extremePrice: number;
      midpoint: number;
      isBoom: boolean;
      delta: number;
      resolved: boolean;
    }
  >();

  // ── REGLA USUARIO: Salida tras Spike en Zona de Retesteo (4 minutos sin nuevo spike) ──
  // Guarda el timestamp cuando un trade con spike alcanza el tope de la zona de retesteo
  private tradeRetestTopeReachedAt = new Map<string, number>();

  // ── REGLA USUARIO: Salida si el retroceso cubre el Spike (3 minutos sin nuevo spike) ──
  // Guarda el timestamp cuando un trade que tuvo spike ve su ganancia cubierta por el retroceso (PnL <= 0)
  private tradeSpikeCoveredAt = new Map<string, number>();

  // ── REGLA USUARIO: Re-entrada automática dentro de la MISMA HORA si el índice vuelve a la zona tras salir en SL o Trailing Stop ──
  private sameHourReentryZones = new Map<
    string,
    {
      symbol: string;
      normSym: string;
      direction: 'BUY' | 'SELL';
      strategy: string;
      entryPrice: number;
      stopLossPrice: number | null;
      exitPrice: number;
      exitReason: string;
      exitTimeMs: number;
      hourEpoch: number;
    }
  >();

  // Puente directo con MetaTrader 5 (detecta automáticamente si existe la ruta local de Weimar o la de .env)
  private readonly mt5FilesDir = (() => {
    const envDir = process.env.MT5_FILES_DIR;
    if (envDir && fs.existsSync(envDir)) return envDir;
    const localWeimarDir =
      'C:/Users/Weimar/AppData/Roaming/MetaQuotes/Terminal/FB9A56D617EDDDFE29EE54EBEFFE96C1/MQL5/Files';
    if (fs.existsSync(localWeimarDir)) return localWeimarDir;
    return envDir || localWeimarDir;
  })();
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
  private processedFeedbackIds = new Set<string>();
  private lastProcessedHistMtime = 0;
  private processedHistoryDeals = new Set<string>();
  private readonly h1AutoAuthorizedEmail = 'weimarsuber@gmail.com';
  private readonly h1EvaluationMinutes = [58, 0];
  private readonly h1ConfirmedEntryMinutes = [58, 0];
  private lastH1EvaluationMinuteKey = -1;
  private h1EvaluationInFlight = false;
  private lastH1AnalysisAt = 0;
  private lastDashboardEvaluationMinuteKey = -1;
  private lastDashboardSignalsScanAt = 0;
  private dashboardSignalsScanInFlight = false;
  private lastCrashBoomAlertMinuteKey = -1;
  private crashBoomAlertInFlight = false;

  constructor(
    @InjectRepository(TradeRecord)
    private readonly tradeRepo: Repository<TradeRecord>,
    private readonly crashIaService: CrashIaStrategyService,
    private readonly h1Service: H1StrategyService,
    private readonly m5PlusService: M5PlusStrategyService,
    private readonly m5XService: M5XStrategyService,
    private readonly eaWeySmcService: EaWeySMCService,
    private readonly smcSyntheticsService: SmcSyntheticsService,
    private readonly statsService: TradingStatsService,
    private readonly usersService: UsersService,
    private readonly evolutionCallService: EvolutionCallService,
    private readonly weySignalsService: WeySignalsService,
    private readonly candlesService: CandlesService,
    private readonly events: EventEmitter2,
  ) {}

  async onModuleInit() {
    // Asegurar columnas de calificación manual en BD y cargar trades abiertos previos
    try {
      await this.tradeRepo
        .query(
          `ALTER TABLE trades ADD COLUMN IF NOT EXISTS "userRating" varchar(15); ALTER TABLE trades ADD COLUMN IF NOT EXISTS "userNotes" varchar(255);`,
        )
        .catch(() => {});

      const openTrades = await this.tradeRepo.find({
        where: { status: 'OPEN' },
      });
      for (const t of openTrades) {
        // Descartar órdenes fantasma sin ticket de sesiones previas o símbolos que no sean Crash/Boom
        const isNotCrashBoom = t.strategy !== 'MANUAL_APP' && !this.isAllowedCrashBoomSymbol(t.symbol);
        if (isNotCrashBoom || (!t.mt5Ticket && (Date.now() / 1000 - Number(t.entryTime || 0)) > 45)) {
          this.tradeRepo.update(t.id, { status: 'CLOSED', exitReason: 'ORPHAN_STARTUP_CLEANED' }).catch(() => {});
          continue;
        }
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

      // Inicializar cooldown de 10 minutos para el Oro si el último trade cerró en Stop Loss
      try {
        const lastGoldTrade = await this.tradeRepo
          .createQueryBuilder('trade')
          .where('(UPPER(trade.symbol) LIKE :gold1 OR UPPER(trade.symbol) LIKE :gold2)', { gold1: '%XAU%', gold2: '%GOLD%' })
          .andWhere('trade.status = :status', { status: 'CLOSED' })
          .orderBy('trade.exitTime', 'DESC')
          .getOne();

        if (lastGoldTrade && (Number(lastGoldTrade.pnlUsd) < -0.05 || lastGoldTrade.result === 'LOSS' || (lastGoldTrade.exitReason && lastGoldTrade.exitReason.includes('SL')))) {
          const exitTimeNum = Number(lastGoldTrade.exitTime);
          const exitEpochMs = exitTimeNum > 1e11 ? exitTimeNum : exitTimeNum * 1000;
          const elapsed = Date.now() - exitEpochMs;
          if (elapsed >= 0 && elapsed < this.GOLD_SL_COOLDOWN_MS) {
            this.lastGoldSlExitAt = exitEpochMs;
            const remSec = Math.ceil((this.GOLD_SL_COOLDOWN_MS - elapsed) / 1000);
            this.logger.warn(
              `⏳ [INICIALIZACIÓN COOLDOWN ORO] Último trade de Oro cerró en SL hace ${Math.floor(elapsed / 60000)}m. Reentradas en XAUUSD bloqueadas por ${remSec}s más.`,
            );
          }
        }
      } catch (errGoldInit) {
        this.logger.debug(`Error al verificar cooldown previo de Oro: ${errGoldInit?.message}`);
      }
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

    // Evaluación continua de déficit / rendimiento horario (cada 60 segundos)
    setInterval(() => {
      this.checkHourlyPerformance().catch(() => {});
    }, 60_000);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── 1. GESTIÓN DE CONFIGURACIÓN Y CONSULTAS ────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Cuenta cuántos trades ABIERTOS de la app hay actualmente para una estrategia dada.
   * Esto permite respetar el límite de 3 entradas por estrategia.
   */
  private getOpenTradeCountByStrategy(
    strategy:
      | 'H1_NO_WICK'
      | 'CRASH_BOOM_IA'
      | 'DOUBLE_WICK_MECHA'
      | 'M5_PLUS'
      | 'M5_X'
      | 'SPIKE_RADAR'
      | 'EA_WEY_SMC'
      | 'SMC_SYNTHETICS'
      | 'DASHBOARD_STARS',
  ): number {
    let count = 0;
    for (const trade of this.activeTradesMap.values()) {
      if (trade.status === 'OPEN' && trade.strategy === strategy) {
        count++;
      }
    }
    return count;
  }

  /**
   * Clasifica el símbolo en una de las 3 categorías de reglas de salida:
   * - CRASH_BOOM: SL máximo 8 min, Trailing Stop 60% siempre que esté en profit
   * - SYNTHETIC_OTHER (Step, Jump, Volatility): SL máximo 7 USD, asegurar 50% en profit si no llega al TP final
   * - FOREX_METALS (XAUUSD, XAGUSD, pares Forex): SL máximo 8 USD, asegurar 60% cuando profit > 8 USD y esperar hasta TP
   */
  getAssetCategory(symbol: string): 'CRASH_BOOM' | 'SYNTHETIC_OTHER' | 'FOREX_METALS' {
    const s = (symbol || '').toUpperCase().replace(/\s+/g, '');
    if (s.includes('CRASH') || s.includes('BOOM')) {
      return 'CRASH_BOOM';
    }
    if (
      s.startsWith('FRX') ||
      s.includes('XAU') ||
      s.includes('XAG') ||
      s.includes('GOLD') ||
      s.includes('SILVER') ||
      s.includes('EURUSD') ||
      s.includes('GBPUSD') ||
      s.includes('GBPJPY') ||
      s.includes('USDJPY')
    ) {
      return 'FOREX_METALS';
    }
    return 'SYNTHETIC_OTHER';
  }

  getBucket(symbol: string): 'CRASH_BOOM' | 'XAUUSD' | 'OTHER' {
    const s = (symbol || '').toUpperCase().replace(/\s+/g, '');
    if (s.includes('CRASH') || s.includes('BOOM')) {
      return 'CRASH_BOOM';
    }
    if (s.includes('XAU') || s.includes('GOLD')) {
      return 'XAUUSD';
    }
    return 'OTHER';
  }

  getBucketLimit(bucket: 'CRASH_BOOM' | 'XAUUSD' | 'OTHER'): number {
    if (bucket === 'CRASH_BOOM') return this.maxCrashBoomTrades;
    if (bucket === 'XAUUSD') return this.maxXauusdTrades;
    return this.maxOtherTrades;
  }

  getOpenTradesCountForBucket(bucket: 'CRASH_BOOM' | 'XAUUSD' | 'OTHER'): number {
    const appCount = Array.from(this.activeTradesMap.values()).filter(
      (t) => t.status === 'OPEN' && this.getBucket(t.symbol) === bucket,
    ).length;
    const mt5Count = (this.mt5Positions || []).filter(
      (p) => Number(p.magic) === 999888 && this.getBucket(p.symbol) === bucket,
    ).length;
    return Math.max(appCount, mt5Count);
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
    const raw = (symbol || '').toUpperCase().trim();
    const s = raw.replace(/\s+/g, '').replace('INDEX', '');

    // Crash & Boom
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

    // Step Index
    if (s.includes('STPRNG') || s.includes('STEP')) return 'STPRNG';

    // Volatility (1s)
    if (s.includes('1HZ100V') || (raw.includes('VOLATILITY 100') && raw.includes('1S'))) return '1HZ100V';
    if (s.includes('1HZ75V') || (raw.includes('VOLATILITY 75') && raw.includes('1S'))) return '1HZ75V';
    if (s.includes('1HZ50V') || (raw.includes('VOLATILITY 50') && raw.includes('1S'))) return '1HZ50V';
    if (s.includes('1HZ25V') || (raw.includes('VOLATILITY 25') && raw.includes('1S'))) return '1HZ25V';
    if (s.includes('1HZ10V') || (raw.includes('VOLATILITY 10') && raw.includes('1S'))) return '1HZ10V';

    // Volatility (Normal)
    if (s === 'R_100' || raw.includes('VOLATILITY 100')) return 'R_100';
    if (s === 'R_75' || raw.includes('VOLATILITY 75')) return 'R_75';
    if (s === 'R_50' || raw.includes('VOLATILITY 50')) return 'R_50';
    if (s === 'R_25' || raw.includes('VOLATILITY 25')) return 'R_25';
    if (s === 'R_10' || raw.includes('VOLATILITY 10')) return 'R_10';

    // Jump Indices
    if (s === 'JD100' || raw.includes('JUMP 100')) return 'JD100';
    if (s === 'JD75' || raw.includes('JUMP 75')) return 'JD75';
    if (s === 'JD50' || raw.includes('JUMP 50')) return 'JD50';
    if (s === 'JD25' || raw.includes('JUMP 25')) return 'JD25';
    if (s === 'JD10' || raw.includes('JUMP 10')) return 'JD10';

    // Forex & Metales
    if (s.includes('XAUUSD')) return 'XAUUSD';
    if (s.includes('XAGUSD')) return 'XAGUSD';
    if (s.includes('GBPJPY')) return 'GBPJPY';
    if (s.includes('GBPUSD')) return 'GBPUSD';
    if (s.includes('EURUSD')) return 'EURUSD';
    if (s.includes('USDJPY')) return 'USDJPY';

    return s;
  }

  toMt5Symbol(symbol: string): string {
    return this.normalizeSymbol(symbol);
  }

  isAllowedCrashBoomSymbol(symbol: string): boolean {
    return this.getAssetCategory(symbol) === 'CRASH_BOOM';
  }

  /**
   * Umbral mínimo de Score IA por símbolo calibrado con Backtesting de 30 días:
   * - CRASH300N, BOOM300N y CRASH500 exigen confluencia Ultra-Sniper >= 92% (7/7 en EA_WEY_SMC) y 30 min de enfriamiento.
   * - Los demás 7 índices rentables en backtest mensual operan desde >= 85%.
   */
  private getMinScoreForSymbol(symbol: string): number {
    const up = (symbol || '').toUpperCase();
    if (up.includes('CRASH300') || up.includes('BOOM300') || up.includes('CRASH500')) {
      return 92;
    }
    return 85;
  }

  private getCooldownMsForSymbol(symbol: string): number {
    const up = (symbol || '').toUpperCase();
    if (up.includes('CRASH300') || up.includes('BOOM300') || up.includes('CRASH500')) {
      return 1_800_000; // 30 minutos para índices de alta selectividad
    }
    return 900_000; // 15 minutos estándar
  }

  getConfig() {
    return {
      h1AutoEnabled: this.h1AutoEnabled,
      dashboardStarsAutoEnabled: this.dashboardStarsAutoEnabled,
      crashBoomAutoEnabled: this.crashBoomAutoEnabled,
      m5PlusAutoEnabled: this.m5PlusAutoEnabled,
      m5XAutoEnabled: this.m5XAutoEnabled,
      smcProAutoEnabled: this.smcProAutoEnabled,
      maxOpenTrades: this.maxOpenTrades,
      maxOpenSymbols: this.maxOpenSymbols,
      maxCrashBoomTrades: this.maxCrashBoomTrades,
      maxXauusdTrades: this.maxXauusdTrades,
      maxOtherTrades: this.maxOtherTrades,
      maxTradesPerSymbol: this.maxTradesPerSymbol,
      tradesCountPerSymbol: Object.fromEntries(this.tradesCountPerSymbol.entries()),
      activeCount: this.activeTradesMap.size,
      activeSymbolCount: this.getActiveSymbolCount(),
      goldSlCooldownLeftSec: Math.max(0, Math.ceil((this.GOLD_SL_COOLDOWN_MS - (Date.now() - this.lastGoldSlExitAt)) / 1000)),
      hourlyDeficitPauseLeftSec: Math.max(0, Math.ceil((this.hourlyDeficitPauseUntil - Date.now()) / 1000)),
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
    if (up.includes('600') && up.includes('CRASH')) return 32.0; // 8 USD a 0.25 lotes
    return 10.0; // ~5 USD a 0.50 lotes
  }

  getMaxSlUsd(symbol: string): number {
    const category = this.getAssetCategory(symbol);
    if (category === 'FOREX_METALS') return 8.0;
    if (category === 'SYNTHETIC_OTHER') return 7.0;
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
  async isTrendFavorable(symbol: string, direction: 'BUY' | 'SELL'): Promise<{
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
    return Array.from(this.activeTradesMap.values())
      .filter((t) => t.status === 'OPEN' && Boolean(t.mt5Ticket))
      .sort((a, b) => Number(b.entryTime) - Number(a.entryTime));
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

    // ── Detección de Spike en tiempo real para H1_NO_WICK y Crash/Boom ──
    // Un spike es un movimiento brusco de precio en un solo tick, relativo al símbolo.
    const prevPrice = this.lastTickPrice.get(sym);
    if (prevPrice && prevPrice > 0) {
      const delta = Math.abs(currentPrice - prevPrice);
      const spikeThreshold = this.getSpikeThreshold(sym);
      const isCb = this.getAssetCategory(sym) === 'CRASH_BOOM';
      const isBoom = (sym || '').toUpperCase().includes('BOOM');
      const isFavorableSpikeDirection = isBoom ? currentPrice > prevPrice : currentPrice < prevPrice;

      if (delta >= spikeThreshold || delta >= 3.5) {
        const prevSpikeAt = this.lastSpikeAt.get(sym) || 0;
        const now = Date.now();
        this.lastSpikeAt.set(sym, now);

        // ── Tracking de origen, extremo y retroceso 50% para Crash/Boom ──
        if (isCb && isFavorableSpikeDirection) {
          const existingSpike = this.lastSpikeDetails.get(sym);
          if (existingSpike && !existingSpike.resolved && (now - existingSpike.timestamp < 8_000)) {
            // Continuación del mismo spike en ticks consecutivos
            if (!isBoom && currentPrice < existingSpike.extremePrice) {
              existingSpike.extremePrice = currentPrice;
              existingSpike.midpoint = Number(((existingSpike.originPrice + existingSpike.extremePrice) / 2).toFixed(3));
              existingSpike.delta = Math.abs(existingSpike.originPrice - existingSpike.extremePrice);
            } else if (isBoom && currentPrice > existingSpike.extremePrice) {
              existingSpike.extremePrice = currentPrice;
              existingSpike.midpoint = Number(((existingSpike.originPrice + existingSpike.extremePrice) / 2).toFixed(3));
              existingSpike.delta = Math.abs(existingSpike.originPrice - existingSpike.extremePrice);
            }
          } else {
            const originPrice = prevPrice;
            const extremePrice = currentPrice;
            const midpoint = Number(((originPrice + extremePrice) / 2).toFixed(3));
            this.lastSpikeDetails.set(sym, {
              timestamp: now,
              originPrice,
              extremePrice,
              midpoint,
              isBoom,
              delta,
              resolved: false,
            });
            this.logger.log(
              `⚡ [SPIKE DETECTADO] ${sym} (${isBoom ? 'BOOM BUY' : 'CRASH SELL'}): delta ${delta.toFixed(3)} pts (Origen: ${originPrice.toFixed(3)}, Extremo: ${extremePrice.toFixed(3)}, Mitad 50%: ${midpoint.toFixed(3)}). Esperando retroceso mínimo al 50% antes de permitir entradas.`,
            );
          }
        } else if (now - prevSpikeAt > 30_000) {
          this.logger.log(
            `⚡ [SPIKE DETECTADO] ${sym}: delta ${delta.toFixed(3)} pts (umbral: ${spikeThreshold}). Spike registrado.`,
          );
        }

        // Asociar el spike solo si el trade realmente entra en terreno positivo (profit >= $1.50 USD o >= 3.0 pts a favor desde entryPrice)
        for (const trade of this.activeTradesMap.values()) {
          if (trade.symbol === sym && trade.status === 'OPEN') {
            const isFavorable =
              (trade.direction === 'BUY' && currentPrice > prevPrice) ||
              (trade.direction === 'SELL' && currentPrice < prevPrice);
            const netFavPts =
              trade.direction === 'BUY'
                ? currentPrice - trade.entryPrice
                : trade.entryPrice - currentPrice;
            const tradeLot = trade.lot || this.getDefaultLotForSymbol(trade.symbol) || 0.5;
            const netFavUsd = netFavPts * tradeLot;
            if (isFavorable && (netFavPts >= 3.0 || netFavUsd >= 1.5)) {
              const prevTradeSpike = this.tradeLastSpikeTime.get(trade.id) || 0;
              this.tradeLastSpikeTime.set(trade.id, now);
              trade.hadSpike = true;
              // Si estaba esperando en zona de retesteo, un nuevo spike resetea el temporizador de 4 minutos
              if (this.tradeRetestTopeReachedAt.has(trade.id)) {
                this.logger.log(
                  `⚡ [NUEVO SPIKE EN RETESTEO] ${sym} (${trade.id}): Ocurrió un nuevo spike en la posición. Reseteando temporizador de 4 minutos de retesteo.`,
                );
                this.tradeRetestTopeReachedAt.delete(trade.id);
              }
              // Si estaba esperando por spike cubierto, un nuevo spike resetea el temporizador de 3 minutos
              if (this.tradeSpikeCoveredAt.has(trade.id)) {
                this.logger.log(
                  `⚡ [NUEVO SPIKE TRAS RETROCESO] ${sym} (${trade.id}): Ocurrió un nuevo spike en la posición. Reseteando temporizador de 3 minutos por spike cubierto.`,
                );
                this.tradeSpikeCoveredAt.delete(trade.id);
              }
              if (now - prevTradeSpike > 15_000) {
                trade.spikeCount = (trade.spikeCount || 0) + 1;
                this.logger.log(
                  `⚡ [SPIKE REGISTRADO EN TRADE ${trade.strategy}] ${sym} (${trade.id}): Spike a favor #${trade.spikeCount} detectado. Iniciando espera y monitoreo de retesteo.`,
                );
              }
            }
          }
        }
      }
    }

    // ── Verificar si el precio ya retrocedió al 50% del spike reciente ──
    const activeSpike = this.lastSpikeDetails.get(sym);
    if (activeSpike && !activeSpike.resolved) {
      if (!activeSpike.isBoom && currentPrice >= activeSpike.midpoint) {
        activeSpike.resolved = true;
        this.logger.log(
          `✅ [RETROCESO 50% ALCANZADO] ${sym}: Precio subió a ${currentPrice.toFixed(3)}, recuperando el 50% (${activeSpike.midpoint.toFixed(3)}) del spike. Entradas autorizadas.`,
        );
      } else if (activeSpike.isBoom && currentPrice <= activeSpike.midpoint) {
        activeSpike.resolved = true;
        this.logger.log(
          `✅ [RETROCESO 50% ALCANZADO] ${sym}: Precio bajó a ${currentPrice.toFixed(3)}, retrocediendo el 50% (${activeSpike.midpoint.toFixed(3)}) del spike. Entradas autorizadas.`,
        );
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
          void this.tradeRepo.update(trade.id, {
            maxProfitUsd: trade.maxProfitUsd,
            maxProfitPoints: trade.maxProfitPoints || 0,
          }).catch(() => {});
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
              `⚡ [SPIKE DETECTADO POR PROFIT] ${sym} (${trade.strategy}): PnL alcanzado +${trade.pnlPoints} pts / +${trade.pnlUsd || 0} USD (Spike #${trade.spikeCount}). Registrando espera obligatoria de 5 minutos tras el spike.`,
            );
          }
          void this.tradeRepo.update(trade.id, {
            hadSpike: true,
            spikeCount: trade.spikeCount || 1,
            maxProfitUsd: trade.maxProfitUsd || 0,
            maxProfitPoints: trade.maxProfitPoints || 0,
          }).catch(() => {});
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
   * Lógica universal de salida y gestión de riesgo virtual (sin marcar SL ni TP en MT5):
   *
   * 1. CRASH_BOOM (Índices Crash y Boom):
   *    - SL máximo por tiempo: 8 minutos (si pasan 8 min sin estar en profit, cierra).
   *    - Trailing Stop: Siempre que esté en profit, asegura el 60% del profit máximo alcanzado.
   *
   * 2. SYNTHETIC_OTHER (Step, Jump, Volatility):
   *    - SL máximo monetario: 7 USD.
   *    - Trailing Stop: Si está en profit, asegura el 50% si se devuelve antes de llegar al TP final virtual.
   *
   * 3. FOREX_METALS (Oro, Plata y Pares de Forex):
   *    - SL máximo monetario: 8 USD.
   *    - Trailing Stop: Asegura el 60% cuando esté en profit mayor a 8 USD y espera hasta el TP final virtual.
   */
  async checkActiveTradeExits() {
    const nowMs = Date.now();
    const CRASH_BOOM_MAX_SL_MS = 8 * 60 * 1000; // 8 minutos máximo para Crash y Boom

    for (const trade of this.activeTradesMap.values()) {
      if (trade.status !== 'OPEN') continue;

      const entryMs = Number(trade.entryTime) * 1000;
      const elapsedMs = nowMs - entryMs;
      const elapsedSec = Math.floor(elapsedMs / 1000);
      const category = this.getAssetCategory(trade.symbol);

      const lot = trade.lot || this.getDefaultLotForSymbol(trade.symbol) || 0.5;
      const currentPnlUsd = (trade.pnlUsd !== undefined && trade.pnlUsd !== 0)
        ? trade.pnlUsd
        : Number((trade.pnlPoints * lot).toFixed(2));
      const maxProfitUsd = Math.max(
        trade.maxProfitUsd || 0,
        Number(((trade.maxProfitPoints || 0) * lot).toFixed(2)),
      );
      if (currentPnlUsd > (trade.maxProfitUsd || 0)) {
        trade.maxProfitUsd = currentPnlUsd;
      }

      const currentPrice =
        trade.currentPrice ||
        this.lastTickPrice.get(trade.symbol) ||
        trade.entryPrice;

      // ── 0) VERIFICAR TAKE PROFIT VIRTUAL (SIN MARCAR TP EN MT5) ──
      // NOTA: Para Crash y Boom NO aplicar TP virtual para permitir continuidad de múltiples spikes
      if (category !== 'CRASH_BOOM' && trade.takeProfitPrice && trade.takeProfitPrice > 0 && currentPrice > 0) {
        const tpReached =
          trade.direction === 'BUY'
            ? currentPrice >= trade.takeProfitPrice
            : currentPrice <= trade.takeProfitPrice;
        if (tpReached && currentPnlUsd > 0) {
          this.logger.log(
            `🎯 [VIRTUAL TP ALCANZADO] ${trade.symbol} (${trade.direction} - ${trade.strategy}): Precio actual ${currentPrice} alcanzó TP virtual ${trade.takeProfitPrice}. Profit: +$${currentPnlUsd.toFixed(2)} USD. Cerrando operación.`,
          );
          await this.closeTrade(trade.id, 'VIRTUAL_TP_REACHED', currentPrice);
          continue;
        }
      }

      // ════════════════════════════════════════════════════════════════════════
      // ── REGLA 1: ÍNDICES CRASH Y BOOM (SL Técnico, SL Monetario -$5 USD, Trailing Escalonado)
      // ════════════════════════════════════════════════════════════════════════
      if (category === 'CRASH_BOOM') {
        const maxLossUsd = this.getMaxSlUsd(trade.symbol);

        // 1.1 STOP LOSS MONETARIO: Cierra si la pérdida flotante alcanza el límite (-$5 USD / -$8 USD Crash 600)
        if (currentPnlUsd <= -maxLossUsd) {
          this.logger.log(
            `🛑 [STOP LOSS MONETARIO -$${maxLossUsd} USD] ${trade.symbol} (${trade.direction} - ${trade.strategy}): Pérdida flotante de $${currentPnlUsd.toFixed(2)} USD. Cerrando trade inmediatamente.`,
          );
          await this.closeTrade(
            trade.id,
            `SL_MAX_LOSS_${maxLossUsd}USD`,
            currentPrice,
          );
          continue;
        }

        // 1.2 STOP LOSS TÉCNICO VIRTUAL: En Crash/Boom se respeta el margen completo del SL monetario (-$5/-$8 USD)
        // para evitar cierres prematuros (-$1.70, -$2.70, -$3.36) cuando el Order Block es muy estrecho.
        if (
          trade.stopLossPrice &&
          trade.stopLossPrice > 0 &&
          currentPrice > 0 &&
          currentPnlUsd <= -maxLossUsd
        ) {
          const slHit =
            trade.direction === 'BUY'
              ? currentPrice <= trade.stopLossPrice
              : currentPrice >= trade.stopLossPrice;
          if (slHit) {
            this.logger.log(
              `🛑 [STOP LOSS TÉCNICO ORDER BLOCK] ${trade.symbol} (${trade.direction} - ${trade.strategy}): Precio actual ${currentPrice} cruzó SL de Order Block (${trade.stopLossPrice}). PnL: $${currentPnlUsd.toFixed(2)} USD. Cerrando operación.`,
            );
            await this.closeTrade(
              trade.id,
              'TECHNICAL_SL_HIT',
              currentPrice,
            );
            continue;
          }
        }

        // 1.3 TRAILING STOP INTELIGENTE ESCALONADO CRASH Y BOOM (NUNCA DEVOLVER GANANCIAS)
        if (maxProfitUsd >= 8.0) {
          const ratio = maxProfitUsd >= 30.0 ? 0.70 : maxProfitUsd >= 15.0 ? 0.60 : 0.50;
          const protectedFloor = Math.max(4.0, Number((maxProfitUsd * ratio).toFixed(2)));
          if (currentPnlUsd <= protectedFloor) {
            this.logger.log(
              `🔒 [TRAILING STOP CRASH/BOOM ${(ratio * 100).toFixed(0)}%] ${trade.symbol} (${trade.direction} - ${trade.strategy}): Pico +${maxProfitUsd.toFixed(2)} USD retrocedió a +${currentPnlUsd.toFixed(2)} USD (piso asegurado ${(ratio * 100).toFixed(0)}%: +${protectedFloor.toFixed(2)} USD). Cerrando con ganancia asegurada.`,
            );
            await this.closeTrade(
              trade.id,
              `TRAILING_${(ratio * 100).toFixed(0)}PCT_CRASH_BOOM`,
              currentPrice,
            );
            continue;
          }
        }

        // ── REGLA USUARIO: SALIDA TRAS SPIKE EN TOPE DE ZONA DE RETESTEO (4 MINUTOS SIN NUEVO SPIKE) ──
        if (trade.hadSpike) {
          const lastSpikeTime = this.tradeLastSpikeTime.get(trade.id) || entryMs;
          let isAtRetestTope = false;
          let retestDesc = '';

          try {
            const evalData = await this.crashIaService.evaluateSymbol(trade.symbol, 5);
            if (evalData) {
              const isBoom = evalData.marketType === 'BOOM';
              const candleHeight = evalData.m5CandleHeight || 3.0;

              // A. Retesteo en consolidación lateral M5
              if (evalData.retestZone?.isInRetest) {
                const ceiling = evalData.retestZone.retestCeiling;
                const floor = evalData.retestZone.retestFloor;
                if (!isBoom) {
                  // En Crash (Venta): al retestear hacia arriba, toca el techo/tope de la zona de retesteo
                  if (currentPrice >= ceiling - candleHeight * 0.35) {
                    isAtRetestTope = true;
                    retestDesc = `Techo de retesteo M5 (${ceiling.toFixed(2)})`;
                  }
                } else {
                  // En Boom (Compra): al retestear hacia abajo, toca el piso/tope de la zona de retesteo
                  if (currentPrice <= floor + candleHeight * 0.35) {
                    isAtRetestTope = true;
                    retestDesc = `Piso de retesteo M5 (${floor.toFixed(2)})`;
                  }
                }
              }

              // B. Estado institucional formal 'EN_RETESTEO'
              if (!isAtRetestTope && evalData.status === 'EN_RETESTEO') {
                isAtRetestTope = true;
                retestDesc = 'Zona formal de retesteo M5';
              }

              // C. Tope de Caja Institucional (boxCeiling en Crash / boxFloor en Boom)
              if (!isAtRetestTope) {
                if (!isBoom && evalData.boxCeiling && currentPrice >= evalData.boxCeiling - candleHeight * 0.25) {
                  isAtRetestTope = true;
                  retestDesc = `Tope de caja (${evalData.boxCeiling.toFixed(2)})`;
                } else if (isBoom && evalData.boxFloor && currentPrice <= evalData.boxFloor + candleHeight * 0.25) {
                  isAtRetestTope = true;
                  retestDesc = `Tope inferior de caja (${evalData.boxFloor.toFixed(2)})`;
                }
              }
            }
          } catch (e: any) {
            // Ignorar errores transitorios en consulta
          }

          if (isAtRetestTope) {
            if (!this.tradeRetestTopeReachedAt.has(trade.id)) {
              this.tradeRetestTopeReachedAt.set(trade.id, nowMs);
              this.logger.log(
                `📍 [TOPE DE RETESTEO TRAS SPIKE] ${trade.symbol} (${trade.direction} - ${trade.strategy}): Posición con spike alcanzó ${retestDesc}. Esperando 4 minutos (240s) por un nuevo spike...`,
              );
            }

            const topeReachedAt = this.tradeRetestTopeReachedAt.get(trade.id)!;
            const timeAtTopeMs = nowMs - topeReachedAt;
            const timeSinceLastSpikeMs = nowMs - lastSpikeTime;
            const FOUR_MIN_MS = 4 * 60 * 1000; // 4 minutos = 240 segundos

            // Si ya transcurrieron 4 minutos en el tope de retesteo y en esos 4 minutos no hubo ningún spike nuevo:
            if (timeAtTopeMs >= FOUR_MIN_MS && timeSinceLastSpikeMs >= FOUR_MIN_MS) {
              const profitText = currentPnlUsd >= 0 ? `+$${currentPnlUsd.toFixed(2)} USD` : `-$${Math.abs(currentPnlUsd).toFixed(2)} USD`;
              this.logger.log(
                `⏱️ [SALIDA 4 MIN SIN NUEVO SPIKE EN RETESTEO] ${trade.symbol} (${trade.direction} - ${trade.strategy}): Pasaron 4 minutos en el tope de retesteo sin nuevo spike. Cerrando trade para asegurar ganancia/resultado (${profitText}).`,
              );
              this.tradeRetestTopeReachedAt.delete(trade.id);
              await this.closeTrade(trade.id, 'RETEST_TOPE_NO_NEW_SPIKE_4MIN', currentPrice);
              continue;
            }
          } else {
            // Si el precio ya no está en el tope de la zona de retesteo, resetear temporizador
            if (this.tradeRetestTopeReachedAt.has(trade.id)) {
              this.tradeRetestTopeReachedAt.delete(trade.id);
            }
          }
        }

        // ── 1.5 REGLA USUARIO: SI TUVO SPIKE REAL EN PROFIT (>= $3 USD) Y EL RETROCESO LO CUBRE TOTALMENTE, ESPERAR 3 MINUTOS SIN NUEVO SPIKE Y SALIR ──
        if (trade.hadSpike && maxProfitUsd >= 3.0) {
          const lastSpikeTime = this.tradeLastSpikeTime.get(trade.id) || entryMs;
          // El retroceso cubre el spike cuando devuelve la ganancia (PnL <= 0)
          const isSpikeCovered = currentPnlUsd <= 0;

          if (isSpikeCovered) {
            if (!this.tradeSpikeCoveredAt.has(trade.id)) {
              this.tradeSpikeCoveredAt.set(trade.id, nowMs);
              this.logger.log(
                `⚠️ [SPIKE CUBIERTO POR RETROCESO] ${trade.symbol} (${trade.direction} - ${trade.strategy}): El retroceso cubrió la ganancia del spike (PnL actual: $${currentPnlUsd.toFixed(2)} USD). Esperando 3 minutos (180s) por un segundo spike antes de salir.`,
              );
            }

            const coveredAt = this.tradeSpikeCoveredAt.get(trade.id)!;
            const timeCoveredMs = nowMs - coveredAt;
            const timeSinceLastSpikeMs = nowMs - lastSpikeTime;
            const THREE_MIN_MS = 3 * 60 * 1000; // 3 minutos = 180 segundos

            // Si transcurrieron 3 minutos desde que se cubrió el spike y en esos 3 minutos no hubo nuevo spike:
            if (timeCoveredMs >= THREE_MIN_MS && timeSinceLastSpikeMs >= THREE_MIN_MS) {
              this.logger.log(
                `⏱️ [SALIDA 3 MIN TRAS SPIKE CUBIERTO] ${trade.symbol} (${trade.direction} - ${trade.strategy}): Pasaron 3 minutos desde que el retroceso cubrió el spike sin nuevo spike. Cerrando trade inmediatamente ($${currentPnlUsd.toFixed(2)} USD).`,
              );
              this.tradeSpikeCoveredAt.delete(trade.id);
              await this.closeTrade(trade.id, 'SPIKE_COVERED_NO_NEW_SPIKE_3MIN', currentPrice);
              continue;
            }
          } else {
            // Si el precio aún está en profit (el spike no ha sido cubierto), limpiar temporizador
            if (this.tradeSpikeCoveredAt.has(trade.id)) {
              this.tradeSpikeCoveredAt.delete(trade.id);
            }
          }
        }

        // ── 1.6 ELIMINADO EL CIERRE PREMATURO A LOS 8 MINUTOS ──
        // Para respetar la instrucción del usuario y el Stop Loss total (técnico y monetario -5 USD),
        // la posición no se cierra prematuramente a los 8 minutos con pérdidas pequeñas.
        continue;
      }

      // ════════════════════════════════════════════════════════════════════════
      // ── REGLA 2: STEP, JUMP Y VOLATILITY (SL máx 7 USD + Asegurar 50% en profit)
      // ════════════════════════════════════════════════════════════════════════
      if (category === 'SYNTHETIC_OTHER') {
        if (currentPnlUsd <= -7.0) {
          this.logger.log(
            `🛑 [STOP LOSS -7 USD SINTÉTICO] ${trade.symbol} (${trade.direction} - ${trade.strategy}): Pérdida flotante de $${currentPnlUsd.toFixed(2)} USD alcanzó el límite de -7 USD. Cerrando inmediatamente.`,
          );
          await this.closeTrade(
            trade.id,
            'SL_MAX_7USD_SYNTHETIC',
            currentPrice,
          );
          continue;
        }

        // Asegurar el 50% solo cuando el profit supere los 8 USD si no llega al TP final
        if (maxProfitUsd > 8.0) {
          const protectedFloor50 = Number((maxProfitUsd * 0.50).toFixed(2));
          if (currentPnlUsd <= protectedFloor50) {
            this.logger.log(
              `🔒 [ASEGURAR 50% PROFIT SINTÉTICO > $8 USD] ${trade.symbol} (${trade.direction} - ${trade.strategy}): Profit máx +$${maxProfitUsd.toFixed(2)} USD (> $8 USD) retrocedió a +$${currentPnlUsd.toFixed(2)} USD (piso 50%: +$${protectedFloor50.toFixed(2)} USD). Cerrando en ganancia.`,
            );
            await this.closeTrade(
              trade.id,
              'TRAILING_50PCT_SYNTHETIC',
              currentPrice,
            );
            continue;
          }
        }
        continue;
      }

      // ════════════════════════════════════════════════════════════════════════
      // ── REGLA 3: PARES DE FOREX Y METALES (SL 8 USD + Asegurar 60% si profit > 8 USD y esperar TP)
      // ════════════════════════════════════════════════════════════════════════
      if (category === 'FOREX_METALS') {
        if (currentPnlUsd <= -8.0) {
          this.logger.log(
            `🛑 [STOP LOSS -8 USD FOREX/METALES] ${trade.symbol} (${trade.direction} - ${trade.strategy}): Pérdida flotante de $${currentPnlUsd.toFixed(2)} USD alcanzó el límite de -8 USD. Cerrando inmediatamente.`,
          );
          await this.closeTrade(
            trade.id,
            'SL_MAX_8USD_FOREX',
            currentPrice,
          );
          continue;
        }

        // Asegurar el 60% cuando esté en profit mayor a 8 USD y esperar hasta el TP
        if (maxProfitUsd > 8.0) {
          const protectedFloor60 = Number((maxProfitUsd * 0.60).toFixed(2));
          if (currentPnlUsd <= protectedFloor60) {
            this.logger.log(
              `🔒 [ASEGURAR 60% FOREX PROFIT > $8 USD] ${trade.symbol} (${trade.direction} - ${trade.strategy}): Profit máx +$${maxProfitUsd.toFixed(2)} USD (> $8 USD) retrocedió a +$${currentPnlUsd.toFixed(2)} USD (piso 60%: +$${protectedFloor60.toFixed(2)} USD). Cerrando con profit asegurado.`,
            );
            await this.closeTrade(
              trade.id,
              'TRAILING_60PCT_FOREX_OVER_8USD',
              currentPrice,
            );
            continue;
          }
        }
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
    const currentMin = now.getMinutes();
    const shouldEvaluateDashboard =
      this.h1EvaluationMinutes.includes(currentMin) &&
      this.lastDashboardEvaluationMinuteKey !== minuteKey;
    const isH1ScheduledWindow = currentMin === 58 || currentMin === 0;

    // H1 se evalúa ÚNICAMENTE si está activo y en el minuto 58 o minuto 00
    if (
      this.h1AutoEnabled &&
      isH1ScheduledWindow &&
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

    // ── AUTO-TRADE SMC PRO · SINTÉTICOS, ORO Y FOREX (cada ~10s) ──
    if (
      this.smcProAutoEnabled &&
      Date.now() - this.lastDashboardSignalsScanAt >= 10_000 &&
      !this.dashboardSignalsScanInFlight
    ) {
      this.lastDashboardSignalsScanAt = Date.now();
      this.dashboardSignalsScanInFlight = true;
      try {
        await this.evaluateAllDashboardSignals();
      } catch (err: any) {
        this.logger.debug(`Error evaluando señales SMC Pro: ${err?.message}`);
      } finally {
        this.dashboardSignalsScanInFlight = false;
      }
    }

    if (this.activeTradesMap.size >= this.maxOpenTrades) return;

    // B. Evaluación Estrategia Crash & Boom IA (Entre línea morada y punteada)
    if (this.crashBoomAutoEnabled) {
      await this.evaluateCrashBoomStrategy();
    }

    // B2. Re-entrada dentro de la MISMA HORA cuando el índice regresa a la zona tras salir en SL o Trailing Stop
    await this.evaluateSameHourZoneReentries();

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
      const currentMinute = new Date().getMinutes();
      // Regla estricta usuario: Se evalúa y envía ÚNICAMENTE en minuto 58 anterior o minuto 00
      if (currentMinute !== 58 && currentMinute !== 0) {
        return false;
      }

      // tolerancePct = 0.05 para estricto Marubozu sin mecha
      const h1Analysis = await this.h1Service.analyzeAllIndices(0.05);
      if (!h1Analysis || !Array.isArray(h1Analysis.activeAlerts)) return false;
      if (!h1Analysis.activeAlerts.length) return false;

      const hourKey = Math.floor(Date.now() / 3_600_000);
      const anticipatedAlerts = h1Analysis.activeAlerts.filter(
        (alert) => alert.isAnticipated && currentMinute === 58,
      );
      const confirmedAlerts = h1Analysis.activeAlerts.filter(
        (alert) => !alert.isAnticipated && currentMinute === 0,
      );

      if (anticipatedAlerts.length) {
        void this.evolutionCallService
          .notifyH1Alerts(anticipatedAlerts, `anticipated-${hourKey}`)
          .catch((err) => {
            this.logger.error(`Error enviando alertas H1 anticipadas: ${err?.message || err}`);
          });
      }
      if (confirmedAlerts.length) {
        void this.evolutionCallService
          .notifyH1Alerts(confirmedAlerts, `confirmed-${hourKey}`)
          .catch((err) => {
            this.logger.error(`Error enviando alertas H1 confirmadas: ${err?.message || err}`);
          });
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

  /**
   * Evalúa automáticamente las 4 secciones del Dashboard y ejecuta el trade en MT5
   * cada vez que aparece una señal activa:
   * 1. Spike Radar · Crash & Boom IA
   * 2. EA WEY SMC · Crash & Boom
   * 3. SMC Pro · Sintéticos (Step, Volatility, Jump), Oro y Forex
   * 4. Wey Trading · Sala de Operaciones (Señales Viables)
   */
  private async evaluateAllDashboardSignals() {
    if (!(await this.isH1AutoTradingAllowed())) return;
    if (this.activeTradesMap.size >= this.maxOpenTrades) return;

    // 1. SECCIÓN 1: Spike Radar · Crash & Boom IA (Solo CRASH600, CRASH900, BOOM1000)
    try {
      const radarSignals = await this.crashIaService.getSpikeRadar();
      for (const sig of (radarSignals || []).filter((s) => s.symbol && this.isAllowedCrashBoomSymbol(s.symbol))) {
        if (this.activeTradesMap.size >= this.maxOpenTrades) break;
        const direction: 'BUY' | 'SELL' | null = sig.canBuy ? 'BUY' : sig.canSell ? 'SELL' : null;
        if (!direction || !sig.symbol || !sig.currentPrice) continue;

        // ── REGLA CALIBRADA BACKTEST 30 DÍAS: Score mínimo por índice (85% estándar / 92% en 300N y CRASH500) ──
        const score = Number(sig.score) || 0;
        const minReqScore = this.getMinScoreForSymbol(sig.symbol);
        if (score < minReqScore) {
          this.logger.debug(`[SPIKE_RADAR ${minReqScore}%] ${sig.symbol} omitido: score ${score}% es menor al ${minReqScore}% requerido.`);
          continue;
        }

        const cooldownKey = `${sig.symbol}_SPIKE_RADAR`;
        const isSameHourReentry = this.isSameHourReentryActive(sig.symbol);
        const cooldownMs = isSameHourReentry ? 45_000 : this.getCooldownMsForSymbol(sig.symbol);
        if (Date.now() - (this.lastTradeOpenedAt.get(cooldownKey) || 0) < cooldownMs) continue;

        const isHighlyViable = true;
        const opened = await this.openTrade({
          strategy: 'SPIKE_RADAR',
          symbol: sig.symbol,
          mercado: sig.mercado || sig.symbol,
          direction,
          entryPrice: sig.currentPrice,
          stopLossPrice: sig.stopLossPrice || null,
          takeProfitPrice: null, // Sin TP fijo para permitir continuidad en Crash/Boom
          isHighlyViable,
          scorePct: score,
        });
        if (opened) {
          this.lastTradeOpenedAt.set(cooldownKey, Date.now());
          this.logger.log(
            `🎯 [AUTO-TRADE DASHBOARD · SPIKE RADAR ≥85%] ${sig.symbol} ${direction} @ ${sig.currentPrice} (Score: ${score}%) enviado a MT5 sin marcar SL/TP.`,
          );
        }
      }
    } catch (e: any) {
      this.logger.debug(`Error en auto-trade Spike Radar: ${e?.message}`);
    }

    // 2. SECCIÓN 2: EA WEY SMC · Crash & Boom (Solo CRASH600, CRASH900, BOOM1000)
    try {
      const eaSmcSignals = await this.eaWeySmcService.scanAll();
      for (const sig of (eaSmcSignals || []).filter((s) => s.ready && s.symbol && this.isAllowedCrashBoomSymbol(s.symbol))) {
        if (this.activeTradesMap.size >= this.maxOpenTrades) break;
        if (!sig.symbol || !sig.direction || !sig.currentPrice) continue;

        // ── REGLA CALIBRADA BACKTEST 30 DÍAS: Score mínimo por índice (85% estándar / 92% = 7/7 en 300N y CRASH500) ──
        const scorePct = Math.round(((sig.score || 0) / 7) * 100);
        const minReqScore = this.getMinScoreForSymbol(sig.symbol);
        if (scorePct < minReqScore) {
          this.logger.debug(`[EA_WEY_SMC ${minReqScore}%] ${sig.symbol} omitido: score ${scorePct}% (${sig.score}/7) es menor al ${minReqScore}% requerido.`);
          continue;
        }

        // Candado Sniper SMC: El precio debe haber alcanzado efectivamente el Order Block
        if (sig.chart?.smcZones?.length) {
          const zone = sig.chart.smcZones[0];
          if (sig.direction === 'SELL' && sig.currentPrice < zone.bottom) {
            continue;
          }
          if (sig.direction === 'BUY' && sig.currentPrice > zone.top) {
            continue;
          }
        }

        const cooldownKey = `${sig.symbol}_EA_WEY_SMC`;
        const isSameHourReentry = this.isSameHourReentryActive(sig.symbol);
        const cooldownMs = isSameHourReentry ? 45_000 : this.getCooldownMsForSymbol(sig.symbol);
        if (Date.now() - (this.lastTradeOpenedAt.get(cooldownKey) || 0) < cooldownMs) continue;

        const isHighlyViable = true;
        const opened = await this.openTrade({
          strategy: 'EA_WEY_SMC',
          symbol: sig.symbol,
          mercado: sig.name || sig.symbol,
          direction: sig.direction,
          entryPrice: sig.currentPrice,
          stopLossPrice: sig.stopLossPrice || null,
          takeProfitPrice: null, // Sin TP fijo para permitir continuidad en Crash/Boom
          isHighlyViable,
          scorePct,
        });
        if (opened) {
          this.lastTradeOpenedAt.set(cooldownKey, Date.now());
          this.logger.log(
            `🤖 [AUTO-TRADE DASHBOARD · EA WEY SMC ≥85%] ${sig.symbol} ${sig.direction} @ ${sig.currentPrice} (Score: ${scorePct}%) enviado a MT5 sin marcar SL/TP.`,
          );
        }
      }
    } catch (e: any) {
      this.logger.debug(`Error en auto-trade EA WEY SMC: ${e?.message}`);
    }

    // 3. SECCIÓN 3: SMC Pro · Sintéticos (Step, Volatility, Jump) y Forex
    // REGLA USUARIO: Restringido temporalmente. Solo operar en índices Crash y Boom.
    // (Se omite el escaneo y apertura de SMC_SYNTHETICS para cumplir instrucción del usuario)
  }

  private async evaluateDashboardStarsStrategy() {
    try {
      if (!(await this.isH1AutoTradingAllowed())) return;
      if (this.activeTradesMap.size >= this.maxOpenTrades) return;

      const { signals } = await this.weySignalsService.getSignals(3, true);
      const candidates = signals.map((signal) => ({
        stars: Number(signal.estrellas),
        direction: signal.direccion,
        entry: Number(signal.entrada),
        stopLoss: Number(signal.sl),
        takeProfit: Number(signal.tp),
        mercado: signal.mercado || signal.symbol,
        symbol: signal.symbol,
      }));

      for (const signal of candidates) {
        const symbol = signal.symbol.toUpperCase();
        const direction = signal.direction === 'COMPRA' ? 'BUY' : signal.direction === 'VENTA' ? 'SELL' : null;
        if (!direction || !Number.isFinite(signal.entry) || signal.entry <= 0) continue;

        // ── REGLA USUARIO ESTRICTA: Solo señales de 5 estrellas (100% >= 90%) ──
        if (signal.stars < 5) {
          this.logger.debug(`[DASHBOARD_STARS 90%] ${symbol} omitido: ${signal.stars} estrellas (< 5 estrellas / < 90%).`);
          continue;
        }

        const hasOpenForSymbol = Array.from(this.activeTradesMap.values()).some(
          (trade) => trade.status === 'OPEN' && this.isSameSymbol(trade.symbol, symbol),
        );
        if (hasOpenForSymbol) continue;

        const cooldownKey = `${symbol}_DASHBOARD_STARS`;
        const lastOpen = this.lastTradeOpenedAt.get(cooldownKey) || 0;
        if (Date.now() - lastOpen < 300_000) continue;

        const openedTrade = await this.openTrade({
          strategy: 'DASHBOARD_STARS',
          symbol,
          mercado: signal.mercado,
          direction,
          entryPrice: signal.entry,
          stopLossPrice: Number.isFinite(signal.stopLoss) && signal.stopLoss > 0 ? signal.stopLoss : null,
          takeProfitPrice: Number.isFinite(signal.takeProfit) && signal.takeProfit > 0 ? signal.takeProfit : null,
          isHighlyViable: true,
          scorePct: 100,
        });

        if (openedTrade) {
          this.lastTradeOpenedAt.set(cooldownKey, Date.now());
          this.logger.log(
            `⭐ [AUTO-TRADE DASHBOARD · SALA WEY] ${symbol} ${direction} (${signal.stars}★) enviado a MT5 sin marcar SL/TP.`,
          );
        }
      }
    } catch (err: any) {
      this.logger.debug(`Error evaluando señales del dashboard: ${err?.message}`);
    }
  }

  async isUserAuthorizedOnline(): Promise<boolean> {
    // Permitir siempre la ejecución automática del bot y el envío a MT5 mientras el servidor esté corriendo
    return true;
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
    // Índices activos Crash & Boom autorizados (máximo 3 concurrentes globales entre todos)
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

        const isHighlyViable = Boolean(doubleWick.isValid);
        const openedTrade = await this.openTrade({
          strategy: 'DOUBLE_WICK_MECHA',
          symbol: sym,
          mercado: doubleWick.mercado || sym,
          direction,
          entryPrice,
          stopLossPrice,
          isHighlyViable,
        });

        if (openedTrade) {
          this.lastTradeOpenedAt.set(`${sym}_DOUBLE_WICK`, Date.now());
          this.doubleWickPatternsExecuted.add(patternKey);
        }
      } catch (e) {
        this.logger.debug(`Error evaluando Double Wick Mecha para ${sym}: ${e?.message}`);
      }
    }

    // ── LÍMITE: Máximo 4 trades abiertos simultáneos entre Crash y Boom ──
    const cbOpenCount = this.getOpenTradesCountForBucket('CRASH_BOOM');
    if (cbOpenCount >= this.maxCrashBoomTrades) {
      this.logger.debug(
        `⛔ [CRASH_BOOM LÍMITE] Ya hay ${cbOpenCount}/${this.maxCrashBoomTrades} trades Crash/Boom abiertos. No se abre nueva entrada.`,
      );
      return;
    }

    for (const sym of symbols) {
      if (this.activeTradesMap.size >= this.maxOpenTrades) break;

      // Revalidar en cada iteración por si se abrió uno durante el bucle
      if (this.getOpenTradesCountForBucket('CRASH_BOOM') >= this.maxCrashBoomTrades) break;

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
      const isSameHourReentry = this.isSameHourReentryActive(sym);
      if (Date.now() - lastOpen < (isSameHourReentry ? 45_000 : 180_000)) continue;

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
          // Zona de Reacción Real: Entrar cuando el precio toca o se ubica entre la Línea Morada (vLine)
          // y la Línea Punteada (50% / dotted50) o el techo de la caja (boxCeiling).
          const inReactionZone =
            (evalData.status === 'EN_BASE_CAJA' || evalData.status === 'EN_ZONA_50') &&
            currentPrice >= vLine &&
            currentPrice <= (evalData.stopLossPrice || boxCeiling * 1.05);

          if (!m5IsViable && inReactionZone && evalData.m5Viability) {
            this.logger.debug(
              `⏳ [M5 EN ESPERA] ${sym} en zona general pero en M5 no es viable aún: ${evalData.m5Viability.reason}`,
            );
          }

          const evalScore = Number(evalData.score) || 0;
          const minReqScore = this.getMinScoreForSymbol(sym);
          const isTrendOk = Boolean(evalData.filters?.trendOk);
          const hasStructure = Boolean(evalData.vCandidate || evalData.activeOrderBlock?.inZone);
          if (inReactionZone && evalData.canSell && isTrendOk && hasStructure && m5IsViable && evalScore >= minReqScore) {
            const stopLossPrice = Number(
              (evalData.stopLossPrice || boxCeiling + (evalData.m5CandleHeight || 3.0)).toFixed(3),
            );
            const takeProfitPrice: number | null = null;

            this.logger.log(
              `🚀 [CRASH IA ENTRADA] ${sym} VENTA (SELL) confirmada en Zona Línea Morada -> 50% y EN TENDENCIA (${evalData.filters?.trendM15}). Precio: ${currentPrice}, Línea Morada: ${vLine}, 50%: ${dotted50}, SL: ${stopLossPrice}`,
            );

            await this.openTrade({
              strategy: 'CRASH_BOOM_IA',
              symbol: sym,
              mercado: evalData.mercado || sym,
              direction: 'SELL',
              entryPrice: currentPrice,
              stopLossPrice,
              takeProfitPrice,
              isHighlyViable: true,
              scorePct: evalScore,
            });

            this.lastTradeOpenedAt.set(`${sym}_CRASH_BOOM`, Date.now());
          }
        } else {
          // ── BOOM (COMPRAS):
          // Zona de Reacción Real: Entrar cuando el precio toca o se ubica entre la Línea Morada (vLine)
          // y la Línea Punteada (50% / dotted50) o el piso de la caja (boxFloor), SIEMPRE EN TENDENCIA.
          const inReactionZone =
            (evalData.status === 'EN_BASE_CAJA' || evalData.status === 'EN_ZONA_50') &&
            currentPrice <= vLine &&
            currentPrice >= (evalData.stopLossPrice || boxFloor * 0.95);

          if (!m5IsViable && inReactionZone && evalData.m5Viability) {
            this.logger.debug(
              `⏳ [M5 EN ESPERA] ${sym} en zona general pero en M5 no es viable aún: ${evalData.m5Viability.reason}`,
            );
          }

          const evalScore = Number(evalData.score) || 0;
          const minReqScore = this.getMinScoreForSymbol(sym);
          const isTrendOk = Boolean(evalData.filters?.trendOk);
          const hasStructure = Boolean(evalData.vCandidate || evalData.activeOrderBlock?.inZone);
          if (inReactionZone && evalData.canBuy && isTrendOk && hasStructure && m5IsViable && evalScore >= minReqScore) {
            const stopLossPrice = Number(
              (evalData.stopLossPrice || boxFloor - (evalData.m5CandleHeight || 3.0)).toFixed(3),
            );
            const takeProfitPrice: number | null = null;

            this.logger.log(
              `🚀 [BOOM IA ENTRADA] ${sym} COMPRA (BUY) confirmada en Zona Línea Morada -> 50% y EN TENDENCIA (${evalData.filters?.trendM15}). Precio: ${currentPrice}, Línea Morada: ${vLine}, 50%: ${dotted50}, SL: ${stopLossPrice}`,
            );

            await this.openTrade({
              strategy: 'CRASH_BOOM_IA',
              symbol: sym,
              mercado: evalData.mercado || sym,
              direction: 'BUY',
              entryPrice: currentPrice,
              stopLossPrice,
              takeProfitPrice,
              isHighlyViable: true,
              scorePct: evalScore,
            });

            this.lastTradeOpenedAt.set(`${sym}_CRASH_BOOM`, Date.now());
          }
        }
      } catch (e) {
        // Silencioso
      }
    }
  }

  /**
   * Verifica si un símbolo tuvo un cierre real (SL o Trailing Stop) dentro de la MISMA HORA actual.
   */
  private isSameHourReentryActive(symbol: string): boolean {
    const normSym = this.normalizeSymbol(symbol);
    const zone = this.sameHourReentryZones.get(normSym);
    if (!zone) return false;
    const currentHourEpoch = Math.floor(Date.now() / 3_600_000);
    if (zone.hourEpoch !== currentHourEpoch) {
      this.sameHourReentryZones.delete(normSym);
      return false;
    }
    return Date.now() - zone.exitTimeMs >= 45_000;
  }

  /**
   * REGLA USUARIO:
   * "cuando cualquier trade se haga y salga sea en sl o por trailing stop,
   * si el indice vuelve a la zona es decir regresa hacer de nuevo el trade si esta dentro de la misma hora"
   */
  private async evaluateSameHourZoneReentries() {
    if (this.sameHourReentryZones.size === 0) return;
    if (this.activeTradesMap.size >= this.maxOpenTrades) return;

    const currentHourEpoch = Math.floor(Date.now() / 3_600_000);

    for (const [normSym, zone] of Array.from(this.sameHourReentryZones.entries())) {
      // Si ya cambió la hora reloj, limpiar la zona de re-entrada
      if (zone.hourEpoch !== currentHourEpoch) {
        this.sameHourReentryZones.delete(normSym);
        continue;
      }

      if (this.activeTradesMap.size >= this.maxOpenTrades) break;
      if (this.getOpenTradesCountForBucket('CRASH_BOOM') >= this.maxCrashBoomTrades) break;

      // Esperar al menos 45s tras el cierre para no duplicar en el mismo tick de salida
      if (Date.now() - zone.exitTimeMs < 45_000) continue;

      // No abrir si ya tiene posición abierta en App o MT5
      const hasOpenInApp = Array.from(this.activeTradesMap.values()).some(
        (t) => t.status === 'OPEN' && this.isSameSymbol(t.symbol, zone.symbol),
      );
      const hasOpenInMt5 = (this.mt5Positions || []).some(
        (p) => this.isSameSymbol(p.symbol, zone.symbol) && Number(p.magic) === 999888,
      );
      if (hasOpenInApp || hasOpenInMt5) continue;

      try {
        const evalData = await this.crashIaService.evaluateSymbol(zone.symbol, 5);
        const currentPrice = this.lastTickPrice.get(zone.symbol) || evalData?.currentPrice || 0;
        if (!currentPrice || currentPrice <= 0) continue;

        const isBoom = zone.symbol.toUpperCase().includes('BOOM');
        const m5Height = evalData?.m5CandleHeight || 2.5;
        const zoneTolerance = Math.max(m5Height * 0.85, 1.5);

        // 1) ¿El precio regresó a la zona original de entrada donde se hizo el trade?
        const backAtOriginalEntryZone = !isBoom
          ? currentPrice >= zone.entryPrice - zoneTolerance &&
            currentPrice <= (zone.stopLossPrice || zone.entryPrice + zoneTolerance * 2.5)
          : currentPrice <= zone.entryPrice + zoneTolerance &&
            currentPrice >= (zone.stopLossPrice || zone.entryPrice - zoneTolerance * 2.5);

        // 2) ¿O el precio regresó a la zona activa de Línea Morada -> 50% (Zonas V)?
        const backAtPurpleZone = Boolean(
          evalData &&
            evalData.vLinePrice > 0 &&
            (evalData.status === 'EN_BASE_CAJA' || evalData.status === 'EN_ZONA_50') &&
            (!isBoom
              ? currentPrice >= evalData.vLinePrice && currentPrice <= (evalData.stopLossPrice || evalData.boxCeiling * 1.05)
              : currentPrice <= evalData.vLinePrice && currentPrice >= (evalData.stopLossPrice || evalData.boxFloor * 0.95)),
        );

        // 3) Asegurar que después de haber salido (en SL o Trailing Stop) el precio esté de regreso en la zona
        //    Y QUE EL ÍNDICE ESTÉ EN TENDENCIA Y CUMPLA CON LO QUE TIENE (canBuy / canSell)
        const distFromExit = Math.abs(currentPrice - zone.exitPrice);
        const returnedAfterMove = distFromExit >= zoneTolerance * 0.4 || Date.now() - zone.exitTimeMs >= 90_000;
        const fulfillsTrendAndSetup = Boolean(
          evalData?.filters?.trendOk && (isBoom ? evalData?.canBuy : evalData?.canSell),
        );

        if ((backAtOriginalEntryZone || backAtPurpleZone) && returnedAfterMove && fulfillsTrendAndSetup) {
          const validStrategy = (
            zone.strategy === 'CRASH_BOOM_IA' ||
            zone.strategy === 'SPIKE_RADAR' ||
            zone.strategy === 'EA_WEY_SMC' ||
            zone.strategy === 'DOUBLE_WICK_MECHA'
              ? zone.strategy
              : 'CRASH_BOOM_IA'
          ) as 'CRASH_BOOM_IA' | 'SPIKE_RADAR' | 'EA_WEY_SMC' | 'DOUBLE_WICK_MECHA';

          const stopLossPrice =
            evalData?.stopLossPrice ||
            zone.stopLossPrice ||
            (!isBoom ? Number((currentPrice + m5Height * 3).toFixed(3)) : Number((currentPrice - m5Height * 3).toFixed(3)));

          this.logger.log(
            `🔁 [RE-ENTRADA MISMA HORA] ${zone.symbol} (${zone.direction}) regresó a la zona (${currentPrice.toFixed(2)}, entrada previa: ${zone.entryPrice.toFixed(2)}, salida previa: ${zone.exitReason}). Ejecutando nuevo trade dentro de la misma hora.`,
          );

          const opened = await this.openTrade({
            strategy: validStrategy,
            symbol: zone.symbol,
            mercado: evalData?.mercado || zone.symbol,
            direction: zone.direction,
            entryPrice: currentPrice,
            stopLossPrice,
            takeProfitPrice: null,
            isHighlyViable: true,
            scorePct: 95,
            isSameHourZoneReentry: true,
          });

          if (opened) {
            this.lastTradeOpenedAt.set(`${zone.symbol}_CRASH_BOOM`, Date.now());
            this.lastTradeOpenedAt.set(`${zone.symbol}_${validStrategy}`, Date.now());
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
    this.logger.log(`🎯 [GAP / PUNTO VIGILADO (2 MIN ANTES) - ${tag}] ${sym} (${params.direction}) @ ${params.entryPrice || 'precio actual'}. Enviando a MT5...`);
    return this.openTrade({
      strategy,
      backtesting: params.isBacktesting,
      symbol: sym,
      mercado: sym,
      direction: params.direction,
      entryPrice: params.entryPrice || 0,
      lot: params.lot,
      isHighlyViable: true,
      scorePct: 95,
    });
  }

  private async openTrade(params: {
    strategy:
      | 'H1_NO_WICK'
      | 'CRASH_BOOM_IA'
      | 'DOUBLE_WICK_MECHA'
      | 'DASHBOARD_STARS'
      | 'MANUAL_APP'
      | 'M5_PLUS'
      | 'M5_X'
      | 'WATCHED_LEVEL'
      | 'WATCHED_LEVEL_BT'
      | 'SPIKE_RADAR'
      | 'EA_WEY_SMC'
      | 'SMC_SYNTHETICS';
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
    isHighlyViable?: boolean;
    scorePct?: number | null;
    isSameHourZoneReentry?: boolean;
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

    // ── BLOQUEO ESTRICTO DE ENTRADAS EN ORO / XAUUSD SOLICITADO POR EL USUARIO ──
    const symUp = (params.symbol || '').toUpperCase().replace(/\s+/g, '');
    const isGold = symUp.includes('XAU') || symUp.includes('GOLD');
    if (isGold && params.strategy !== 'MANUAL_APP') {
      this.logger.warn(
        `⛔ [ORO BLOQUEADO] Entrada automática en ${params.symbol} (${params.strategy}) rechazada por instrucción del usuario.`,
      );
      return null;
    }

    // ── CANDADO DE ESTRATEGIAS Y SÍMBOLOS AUTORIZADOS ──
    // Regla de usuario:
    // 1. SMC Pro (SMC_SYNTHETICS) y órdenes manuales (MANUAL_APP) siempre autorizadas (excepto Oro).
    // 2. Estrategias Crash & Boom (CRASH_BOOM_IA, SPIKE_RADAR, EA_WEY_SMC, DOUBLE_WICK_MECHA)
    //    autorizadas para TODOS los índices Crash y Boom (máx 3 concurrentes).
    // 3. Cualquier otra combinación de estrategia o símbolo queda estrictamente bloqueada.
    const strategyName: string = params.strategy;
    const isSMC = strategyName === 'SMC_SYNTHETICS';
    const isManual = strategyName === 'MANUAL_APP';
    const isWatchedGapTrade = strategyName === 'WATCHED_LEVEL' || strategyName === 'WATCHED_LEVEL_BT';
    const isCrashBoomStrategy =
      strategyName === 'CRASH_BOOM_IA' ||
      strategyName === 'SPIKE_RADAR' ||
      strategyName === 'EA_WEY_SMC' ||
      strategyName === 'DOUBLE_WICK_MECHA' ||
      isWatchedGapTrade;
    const isAllowedCbSymbol = this.isAllowedCrashBoomSymbol(params.symbol);

    // ── REGLA USUARIO: SOLO CRASH Y BOOM (TODO LO DEMÁS RESTRINGIDO) ──
    if (!isManual && !(isCrashBoomStrategy && isAllowedCbSymbol)) {
      this.logger.warn(
        `⛔ [RESTRINGIDO POR USUARIO] Solo Crash y Boom están autorizados para operar. Bloqueada orden de ${params.strategy} para ${params.symbol}.`,
      );
      return null;
    }

    // Para todos los índices Crash & Boom: garantizar que no haya TP virtual fijo para dar continuidad a los spikes
    if (isAllowedCbSymbol) {
      params.takeProfitPrice = null;
    }

    // ── CANDADO DE CONCURRENCIA POR GRUPO (4 Crash/Boom, 0 XAUUSD, 0 Demás) ──
    if (params.strategy !== 'MANUAL_APP') {
      const bucket = this.getBucket(params.symbol);
      const limit = this.getBucketLimit(bucket);
      const currentInBucket = this.getOpenTradesCountForBucket(bucket);
      const bucketNames: Record<string, string> = {
        CRASH_BOOM: 'Crash y Boom (máximo 4)',
        XAUUSD: 'XAUUSD Oro (bloqueado)',
        OTHER: 'Otros índices y Forex (restringido por usuario: 0)',
      };

      if (currentInBucket >= limit) {
        this.logger.warn(
          `⛔ [BLOQUEO CONCURRENCIA GRUPO] Límite de ${bucketNames[bucket]} alcanzado (${currentInBucket}/${limit} activos). Bloqueada orden para ${params.symbol}.`,
        );
        return null;
      }

      // Límite global de respaldo (máximo 6 trades simultáneos en total)
      const totalApp = Array.from(this.activeTradesMap.values()).filter((t) => t.status === 'OPEN').length;
      const totalMt5 = (this.mt5Positions || []).filter((p) => Number(p.magic) === 999888).length;
      if (Math.max(totalApp, totalMt5) >= this.maxOpenTrades) {
        this.logger.warn(
          `⛔ [BLOQUEO CONCURRENCIA GLOBAL] Límite global de ${this.maxOpenTrades} trades simultáneos alcanzado. Bloqueada orden para ${params.symbol}.`,
        );
        return null;
      }

      // ── CANDADO ANTI-REENTRADA EN EL ORO TRAS SALIDA EN STOP LOSS (10 MINUTOS) ──
      if (this.getBucket(params.symbol) === 'XAUUSD') {
        const msSinceGoldSl = Date.now() - this.lastGoldSlExitAt;
        if (this.lastGoldSlExitAt > 0 && msSinceGoldSl < this.GOLD_SL_COOLDOWN_MS) {
          const msLeft = this.GOLD_SL_COOLDOWN_MS - msSinceGoldSl;
          const minLeft = Math.floor(msLeft / 60000);
          const secLeft = Math.floor((msLeft % 60000) / 1000);
          this.logger.warn(
            `⏳ [BLOQUEO SL ORO] XAUUSD cerró previamente en Stop Loss hace ${Math.floor(msSinceGoldSl / 1000)}s. Prohibida reentrada. Esperando 10 minutos de enfriamiento (${minLeft}m ${secLeft}s restantes).`,
          );
          return null;
        }
      }

      // ── CANDADO DE 30 MINUTOS TRAS SALIDA EN STOP LOSS EN EL MISMO ÍNDICE ──
      // REGLA USUARIO: Si está dentro de la MISMA HORA y vuelve a la zona, se permite re-entrar aunque haya salido en SL o Trailing Stop.
      const normSymKey = this.normalizeSymbol(params.symbol);
      const isSameHourReentry = params.isSameHourZoneReentry === true || this.isSameHourReentryActive(params.symbol);
      const lastSl = Math.max(
        this.lastSymbolSlExitAt.get(params.symbol) || 0,
        this.lastSymbolSlExitAt.get(normSymKey) || 0,
      );
      const elapsedSinceSl = Date.now() - lastSl;
      if (lastSl > 0 && elapsedSinceSl < this.SYMBOL_SL_COOLDOWN_MS && !isSameHourReentry) {
        const isViableSignal = params.isHighlyViable === true || (params.scorePct != null && params.scorePct >= 85);
        if (!isViableSignal) {
          const remSec = Math.ceil((this.SYMBOL_SL_COOLDOWN_MS - elapsedSinceSl) / 1000);
          const remMin = Math.floor(remSec / 60);
          this.logger.warn(
            `🛑 [COOLDOWN SL 30 MIN] ${params.symbol} (${params.strategy}): Salió en SL hace ${Math.floor(elapsedSinceSl / 60000)}m. Bloqueando re-entrada en este índice por ${remMin}m ${remSec % 60}s más (señal no alcanza el 85% de viabilidad).`,
          );
          return null;
        } else {
          this.logger.log(
            `⚡ [EXCEPCIÓN COOLDOWN SL 30 MIN] ${params.symbol} (${params.strategy}): Enfriamiento activo de 30m, pero se AUTORIZA entrada por ALTA VIABILIDAD (Score: ${params.scorePct || 85}% >= 85%).`,
          );
        }
      } else if (isSameHourReentry && lastSl > 0 && elapsedSinceSl < this.SYMBOL_SL_COOLDOWN_MS) {
        this.logger.log(
          `🔁 [RE-ENTRADA EN LA MISMA HORA AUTORIZADA] ${params.symbol} (${params.strategy}): El índice volvió a la zona dentro de la misma hora tras salir previamente.`,
        );
      }

      // ── CANDADO DE PAUSA HORARIA POR DÉFICIT / PÉRDIDA ACUMULADA ──
      if (Date.now() < this.hourlyDeficitPauseUntil) {
        if (!params.isHighlyViable) {
          const remSec = Math.ceil((this.hourlyDeficitPauseUntil - Date.now()) / 1000);
          const remMin = Math.floor(remSec / 60);
          this.logger.warn(
            `⛔ [PAUSA HORARIA POR DÉFICIT ACTIVA] ${params.symbol} (${params.strategy}) descartada. Restan ${remMin}m ${remSec % 60}s de pausa horaria. Solo se permiten entradas con calificación MUY VIABLE.`,
          );
          return null;
        } else {
          this.logger.log(
            `🌟 [ENTRADA MUY VIABLE PERMITIDA EN PAUSA HORARIA] ${params.symbol} (${params.strategy}) aprobada por cumplir confluencia estricta / máxima viabilidad.`,
          );
        }
      }
    }

    // ── CANDADO DE UNICIDAD POR SÍMBOLO: MÁXIMO 1 OPERACIÓN SIMULTÁNEA POR ÍNDICE (PERMITE 2DA ENTRADA SI ES POR GAP) ──
    const normSym = this.normalizeSymbol(params.symbol);
    if (params.strategy !== 'MANUAL_APP') {
      if (this.openingSymbolsInFlight.has(normSym)) {
        this.logger.warn(`⛔ [BLOQUEO IN-FLIGHT] Ya se está procesando la apertura de una orden para ${params.symbol}.`);
        return null;
      }

      const openTradesForSym = Array.from(this.activeTradesMap.values()).filter(
        (t) => t.status === 'OPEN' && this.isSameSymbol(t.symbol, params.symbol),
      );
      const hasGapTradeOpen = openTradesForSym.some(
        (t) => t.strategy === 'WATCHED_LEVEL' || t.strategy === 'WATCHED_LEVEL_BT',
      );
      // Si la nueva entrada es por Gap (WATCHED_LEVEL) o ya había una de Gap abierta, se permite una 2da entrada en ese índice
      const maxPerSymbol = isWatchedGapTrade || hasGapTradeOpen ? 2 : 1;

      if (openTradesForSym.length >= maxPerSymbol) {
        this.logger.warn(
          `⛔ [BLOQUEO MULTI-TRADE] Ya existen ${openTradesForSym.length}/${maxPerSymbol} órdenes activas en la app para ${params.symbol}. No se permite otra orden simultánea.`,
        );
        return null;
      }

      const openMt5ForSym = (this.mt5Positions || []).filter(
        (p) => this.isSameSymbol(p.symbol, params.symbol) && Number(p.magic) === 999888,
      );
      if (openMt5ForSym.length >= maxPerSymbol) {
        this.logger.warn(
          `⛔ [BLOQUEO MULTI-TRADE MT5] Ya existen ${openMt5ForSym.length}/${maxPerSymbol} posiciones abiertas en MT5 para ${params.symbol}. No se permite otra orden simultánea.`,
        );
        return null;
      }

      if (openTradesForSym.length === 1 || openMt5ForSym.length === 1) {
        this.logger.log(
          `🎯 [2DA ENTRADA PERMITIDA EN ÍNDICE] ${params.symbol} (${params.strategy}): Ya existe 1 operación activa en este índice y se autoriza la 2da entrada por confluencia de Gap.`,
        );
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
      const isSameHourZoneReentry = params.isSameHourZoneReentry === true || this.isSameHourReentryActive(params.symbol);
      if (
        params.strategy !== 'MANUAL_APP' &&
        params.strategy !== 'H1_NO_WICK' &&
        params.strategy !== 'WATCHED_LEVEL' &&
        params.strategy !== 'WATCHED_LEVEL_BT' &&
        !isSameHourZoneReentry
      ) {
        const lastOpen = this.lastSymbolTradeOpenedAt.get(params.symbol) || 0;
        const elapsed = Date.now() - lastOpen;
        const lastResult = this.lastSymbolTradeResult.get(params.symbol);
        // Si el último trade en este símbolo fue una pérdida, aplicar cooldown extendido
        const requiredCooldown = lastResult === 'LOSS'
          ? this.GLOBAL_SYMBOL_COOLDOWN_MS + this.LOSS_PENALTY_COOLDOWN_MS
          : this.GLOBAL_SYMBOL_COOLDOWN_MS;
        const isViableSignal = params.isHighlyViable === true || (params.scorePct != null && params.scorePct >= 85);
        if (lastOpen > 0 && elapsed < requiredCooldown && !isViableSignal) {
          const secsLeft = Math.ceil((requiredCooldown - elapsed) / 1000);
          const minLeft = Math.floor(secsLeft / 60);
          const penalty = lastResult === 'LOSS' ? ` (penalización por pérdida previa)` : '';
          this.logger.warn(
            `🛡️ [COOLDOWN GLOBAL SÍMBOLO] ${params.symbol} (${params.strategy}): Último trade hace ${Math.floor(elapsed / 60000)}m${penalty}. Bloqueando por ${minLeft}m ${secsLeft % 60}s más.`,
          );
          return null;
        }
      }

      // ── REGLA USUARIO 1: NO HACER TRADE INMEDIATAMENTE TRAS UN SPIKE (ESPERAR AL MENOS AL 50% DE RETROCESO) ──
      // Si es una re-entrada en la misma hora o una entrada de Gap (que ya validó tendencia M15 + retroceso M1 + 2 min antes), permitir directamente.
      if (this.getAssetCategory(params.symbol) === 'CRASH_BOOM' && !isSameHourZoneReentry && !isWatchedGapTrade) {
        const isBoom = (params.symbol || '').toUpperCase().includes('BOOM');
        const currentPrice = Number(params.entryPrice) || this.lastTickPrice.get(params.symbol) || 0;
        let spike = this.lastSpikeDetails.get(params.symbol);
        const now = Date.now();

        // Si no hay spike en memoria o el registrado expiró/resolvió, revisar si en velas M1 recientes ocurrió un spike
        if ((!spike || spike.resolved || now - spike.timestamp > 20 * 60 * 1000) && currentPrice > 0) {
          try {
            const m1Candles = await this.candlesService.findLatest(params.symbol, 60, 15);
            if (m1Candles && m1Candles.length > 0) {
              const spikeThresh = this.getSpikeThreshold(params.symbol);
              for (let i = m1Candles.length - 1; i >= Math.max(0, m1Candles.length - 12); i--) {
                const c = m1Candles[i];
                const cOpen = Number(c.open);
                const cClose = Number(c.close);
                const cHigh = Number(c.high);
                const cLow = Number(c.low);
                const candleDrop = isBoom ? (cClose - cOpen) : (cOpen - cClose);
                const candleEpochMs = Number(c.epoch) * 1000;
                if (candleDrop >= spikeThresh && (now - candleEpochMs < 20 * 60 * 1000)) {
                  const originPrice = isBoom ? cLow : cHigh;
                  const extremePrice = isBoom ? cHigh : cLow;
                  const midpoint = Number(((originPrice + extremePrice) / 2).toFixed(3));
                  const isResolved = !isBoom ? currentPrice >= midpoint : currentPrice <= midpoint;
                  spike = {
                    timestamp: candleEpochMs,
                    originPrice,
                    extremePrice,
                    midpoint,
                    isBoom,
                    delta: candleDrop,
                    resolved: isResolved,
                  };
                  this.lastSpikeDetails.set(params.symbol, spike);
                  break;
                }
              }
            }
          } catch (e: any) {
            // Ignorar
          }
        }

        if (spike && !spike.resolved && (now - spike.timestamp < 20 * 60 * 1000) && currentPrice > 0) {
          if (!isBoom && currentPrice < spike.midpoint) {
            const pct = Math.max(0, Math.min(100, ((currentPrice - spike.extremePrice) / (spike.originPrice - spike.extremePrice)) * 100));
            this.logger.warn(
              `⏳ [ESPERA 50% RETROCESO SPIKE] ${params.symbol} (${params.strategy}): Hubo un spike bajista (${spike.delta.toFixed(2)} pts). Precio actual: ${currentPrice.toFixed(2)} está al ${pct.toFixed(1)}% de retroceso. No operar inmediatamente: esperando que suba al menos a la mitad del spike (${spike.midpoint.toFixed(2)}).`,
            );
            return null;
          } else if (isBoom && currentPrice > spike.midpoint) {
            const pct = Math.max(0, Math.min(100, ((spike.extremePrice - currentPrice) / (spike.extremePrice - spike.originPrice)) * 100));
            this.logger.warn(
              `⏳ [ESPERA 50% RETROCESO SPIKE] ${params.symbol} (${params.strategy}): Hubo un spike alcista (${spike.delta.toFixed(2)} pts). Precio actual: ${currentPrice.toFixed(2)} está al ${pct.toFixed(1)}% de retroceso. No operar inmediatamente: esperando que baje al menos a la mitad del spike (${spike.midpoint.toFixed(2)}).`,
            );
            return null;
          } else {
            spike.resolved = true;
          }
        }
      }

      // ── FILTRO DE TENDENCIA MACRO (EMA 20 en M15): NO OPERAR CONTRA LA TENDENCIA ──
      // Aplica a estrategias de Crash/Boom tradicionales; las señales del Dashboard (SPIKE_RADAR, EA_WEY_SMC, SMC_SYNTHETICS, DASHBOARD_STARS, WATCHED_LEVEL)
      // ya validan su propia estructura institucional multi-timeframe.
      const isDashboardValidatedStrategy =
        params.strategy === 'CRASH_BOOM_IA' ||
        params.strategy === 'SPIKE_RADAR' ||
        params.strategy === 'EA_WEY_SMC' ||
        params.strategy === 'SMC_SYNTHETICS' ||
        params.strategy === 'DASHBOARD_STARS' ||
        isWatchedGapTrade;
      if (
        params.strategy !== 'MANUAL_APP' &&
        params.strategy !== 'H1_NO_WICK' &&
        !isDashboardValidatedStrategy &&
        this.getAssetCategory(params.symbol) === 'CRASH_BOOM'
      ) {
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
      // Si es una re-entrada porque el índice regresó a la zona en la misma hora, se permite operar.
      if (
        params.strategy !== 'MANUAL_APP' &&
        params.strategy !== 'H1_NO_WICK' &&
        !isSameHourZoneReentry
      ) {
        const adaptiveCheck = await this.statsService.canTradeAdaptive(params.symbol, params.strategy);
        if (!adaptiveCheck.allowed) {
          this.logger.warn(`🛡️ [RETROALIMENTACIÓN IA BLOQUEADA] ${params.symbol}: ${adaptiveCheck.reason}`);
          return null;
        }
      }

      let lot = (params as any).lot || this.getDefaultLotForSymbol(params.symbol);
      const maxLossUsd = this.getMaxSlUsd(params.symbol);

      // Usar precio real de tick más reciente si está disponible para evitar desfases con velas antiguas
      const livePrice = this.lastTickPrice.get(params.symbol);
      if (livePrice && livePrice > 0) {
        params.entryPrice = livePrice;
      }

      // ── ALINEAR SL TÉCNICO CON EL SL MONETARIO ──
      // Si la distancia al SL técnico × lote supera el máximo en USD, el SL monetario cerraría el trade
      // ANTES de que el precio llegue al SL técnico. En ese caso se reduce el lote para que el SL técnico
      // quepa dentro del riesgo máximo; si ni con el lote mínimo cabe, la entrada se descarta.
      if (
        params.strategy !== 'MANUAL_APP' &&
        this.getAssetCategory(params.symbol) === 'CRASH_BOOM' &&
        params.stopLossPrice && params.stopLossPrice > 0 && params.entryPrice > 0
      ) {
        const riskPts = Math.abs(params.entryPrice - params.stopLossPrice);
        const riskUsd = riskPts * lot;
        if (riskUsd > maxLossUsd) {
          const minLot = this.getMinLotForSymbol(params.symbol);
          const adjustedLot = Math.max(minLot, Math.floor((maxLossUsd / riskPts) * 100) / 100);
          this.logger.log(
            `⚖️ [LOTE AJUSTADO AL RIESGO] ${params.symbol} (${params.strategy}): SL técnico a ${riskPts.toFixed(2)} pts ` +
            `($${riskUsd.toFixed(2)} con lote ${lot}). Lote ajustado a ${adjustedLot} (SL monetario máx $${maxLossUsd} USD).`,
          );
          lot = adjustedLot;
        }
      }

      const slDistPoints = Number((maxLossUsd / lot).toFixed(3));

      // Guardar SL virtual de referencia en la BD (NUNCA se envía a MT5 porque el usuario pidió no marcar SL ni TP)
      if (!params.stopLossPrice) {
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
        scorePct: params.scorePct ?? null,
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

      const cat = this.getAssetCategory(trade.symbol);
      const riskRuleLabel =
        cat === 'CRASH_BOOM'
          ? 'Crash/Boom: SL máx 8 min | Asegurar 60% si profit > $8 USD'
          : cat === 'SYNTHETIC_OTHER'
          ? 'Step/Jump/Volatility: SL máx $7 USD | Asegurar 50% si profit > $8 USD'
          : 'Forex/Metales: SL máx $8 USD | Asegurar 60% si profit > $8 USD y esperar TP';

      const consoleBanner = [
        '\n╔══════════════════════════════════════════════════════════════════════════════╗',
        `║ 🚀 ENVIANDO ORDEN DE TRADE A METATRADER 5                                    ║`,
        '╠══════════════════════════════════════════════════════════════════════════════╣',
        `║ • Estrategia   : ${stratLabel}`,
        `║ • Símbolo      : ${trade.symbol} -> MT5: ${this.toMt5Symbol(trade.symbol)} (${trade.mercado || trade.symbol})`,
        `║ • Dirección    : ${trade.direction}`,
        `║ • Lote         : ${lot}`,
        `║ • Precio Entr. : ${trade.entryPrice}`,
        `║ • SL / TP MT5  : SIN MARCAR (0.0 / 0.0) — Gestión Virtual Oculta`,
        `║ • TP Virtual   : ${trade.takeProfitPrice || 'Dinámico / Por Trailing'}`,
        `║ • Regla Riesgo : ${riskRuleLabel}`,
        `║ • Trade ID     : ${trade.id}`,
        '╚══════════════════════════════════════════════════════════════════════════════╝',
      ].join('\n');
      // eslint-disable-next-line no-console
      console.log(consoleBanner);

      this.logger.log(
        `🚀 [TRADE OPENED - ${stratLabel}] ${trade.symbol} (${trade.direction}) @ ${trade.entryPrice}. Lot: ${lot}. Regla: [${riskRuleLabel}] (SIN MARCAR SL/TP EN MT5).`,
      );

      // ── Enviar orden al puente de MetaTrader 5 SIN MARCAR SL NI TP (sl=0, tp=0) ──
      await this.sendMt5Command({
        id: `cmd_${randomUUID().slice(0, 8)}`,
        tradeId: trade.id,
        action: 'OPEN',
        symbol: this.toMt5Symbol(trade.symbol),
        direction: trade.direction,
        entryPrice: trade.entryPrice,
        stopLossPrice: 0,
        takeProfitPrice: 0,
        lot: trade.lot || this.getDefaultLotForSymbol(trade.symbol),
        comment: mt5Comment,
        score: trade.scorePct ?? 85,
        isHighlyViable: true,
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
    this.tradeRetestTopeReachedAt.delete(id);
    this.tradeSpikeCoveredAt.delete(id);

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

    // ── Si el trade fue en el Oro (XAUUSD) y salió en SL o pérdida, activar cooldown de 10 min ──
    if (
      this.getBucket(trade.symbol) === 'XAUUSD' &&
      (trade.pnlUsd < -0.05 || trade.result === 'LOSS' || (reason && reason.includes('SL')))
    ) {
      this.lastGoldSlExitAt = Date.now();
      this.logger.warn(
        `🛑 [SL ORO DETECTADO] XAUUSD cerró con Stop Loss / Pérdida ($${trade.pnlUsd} USD, motivo: ${reason}). Activado cooldown de 10 minutos: prohibidas reentradas en el Oro.`,
      );
    }

    // ── REGLA USUARIO: Si el trade cerró con SL o pérdida real en mercado (< -$0.05), activar 30 minutos de espera en el mismo índice ──
    const isSlOrLoss =
      ((trade.pnlUsd !== undefined && trade.pnlUsd < -0.05) ||
        trade.result === 'LOSS' ||
        (reason && reason.toUpperCase().includes('SL'))) &&
      reason !== 'MT5_TIMEOUT_NO_FILL' &&
      !reason.includes('NO_FILL');

    if (isSlOrLoss && trade.strategy !== 'MANUAL_APP') {
      const normSym = this.normalizeSymbol(trade.symbol);
      this.lastSymbolSlExitAt.set(trade.symbol, Date.now());
      this.lastSymbolSlExitAt.set(normSym, Date.now());
      this.logger.warn(
        `🛑 [SL DETECTADO - COOLDOWN 30 MIN] ${trade.symbol} (${trade.strategy}) salió en SL ($${trade.pnlUsd} USD, motivo: ${reason}). (Se permitirá re-entrada si vuelve a la zona dentro de la misma hora).`,
      );
    }

    // ── REGLA USUARIO: Guardar la zona de entrada al cerrar (en SL o Trailing Stop) para re-entrar si vuelve a la zona en la misma hora ──
    if (
      reason !== 'MT5_TIMEOUT_NO_FILL' &&
      reason !== 'ORPHAN_STARTUP_CLEANED' &&
      !String(reason || '').includes('NO_FILL') &&
      !String(reason || '').startsWith('MT5_REJECTED') &&
      !String(reason || '').startsWith('MT5_ERROR') &&
      this.isAllowedCrashBoomSymbol(trade.symbol) &&
      Number(trade.entryPrice) > 0
    ) {
      const normSym = this.normalizeSymbol(trade.symbol);
      this.sameHourReentryZones.set(normSym, {
        symbol: trade.symbol,
        normSym,
        direction: trade.direction,
        strategy: trade.strategy,
        entryPrice: Number(trade.entryPrice),
        stopLossPrice: trade.stopLossPrice ? Number(trade.stopLossPrice) : null,
        exitPrice: Number(trade.exitPrice || trade.currentPrice || trade.entryPrice),
        exitReason: reason,
        exitTimeMs: Date.now(),
        hourEpoch: Math.floor(Date.now() / 3_600_000),
      });
      this.logger.log(
        `📌 [ZONA GUARDADA MISMA HORA] ${trade.symbol} (${trade.direction}) cerrado por [${reason}] @ ${trade.exitPrice}. Si regresa a la zona (~${trade.entryPrice}) dentro de esta hora, se re-abrirá el trade.`,
      );
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

    // Evaluar déficit o pérdida en la última hora tras cierre de operación
    this.checkHourlyPerformance().catch(() => {});

    // ── Enviar orden de cierre al puente de MetaTrader 5 ÚNICAMENTE si tiene ticket explícito vinculado ──
    // NUNCA enviar cierre a MT5 si el motivo es MT5_TIMEOUT_NO_FILL (la orden nunca existió en MT5 y no debe matar posiciones vivas ajenas)
    if (reason !== 'MT5_CLOSED' && reason !== 'MT5_TIMEOUT_NO_FILL' && !reason.includes('NO_FILL')) {
      const ticketToClose = trade.mt5Ticket ? Number(trade.mt5Ticket) : 0;
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
    if (!fb) return;
    const fbKey = fb.cmdId || `${fb.tradeId}_${fb.time}_${fb.status}`;
    if (this.processedFeedbackIds.has(fbKey)) {
      return;
    }
    this.processedFeedbackIds.add(fbKey);
    if (this.processedFeedbackIds.size > 3000) {
      const arr = Array.from(this.processedFeedbackIds);
      this.processedFeedbackIds = new Set(arr.slice(arr.length - 1500));
    }

    if (fb && fb.tradeId && fb.ticket) {
      const trade = this.activeTradesMap.get(fb.tradeId);
      if (trade && !trade.mt5Ticket) {
        trade.mt5Ticket = String(fb.ticket);
        await this.tradeRepo
          .update(trade.id, { mt5Ticket: trade.mt5Ticket })
          .catch(() => {});
        // eslint-disable-next-line no-console
        console.log(
          `\n✅ [MT5 CONFIRMADO] Orden ejecutada en MetaTrader 5 -> Ticket #${fb.ticket} | ${trade.symbol} (${trade.direction}) | Estrategia: ${trade.strategy}\n`,
        );
        this.logger.log(
          `🎯 [MT5 BRIDGE] ¡Operación confirmada en MetaTrader 5! Ticket #${fb.ticket} para ${trade.symbol}`,
        );
      }
    } else if (fb && (fb.status === 'ERROR' || String(fb.status || '').startsWith('REJECTED'))) {
      // eslint-disable-next-line no-console
      console.error(
        `\n❌ [MT5 ${fb.status}] MetaTrader 5 rechazó o falló al ejecutar comando (${fb.cmdId || ''}): ${fb.msg || 'Error desconocido'}\n`,
      );
      this.logger.error(
        `❌ [MT5 BRIDGE ${fb.status}] Falló comando ${fb.cmdId || ''} (tradeId=${fb.tradeId || ''}): ${fb.msg || ''}`,
      );
      if (fb.tradeId && this.activeTradesMap.has(fb.tradeId)) {
        const rejectedTrade = this.activeTradesMap.get(fb.tradeId);
        if (rejectedTrade && !rejectedTrade.mt5Ticket) {
          this.activeTradesMap.delete(fb.tradeId);
          // Evitar reintentos en bucle cada 2.5s cuando MT5 rechaza una orden
          const rejSym = rejectedTrade.symbol;
          if (rejSym) {
            this.lastTradeOpenedAt.set(`${rejSym}_CRASH_BOOM`, Date.now());
            this.lastTradeOpenedAt.set(`${rejSym}_${rejectedTrade.strategy}`, Date.now());
            this.lastSymbolTradeOpenedAt.set(rejSym, Date.now());
          }
          await this.tradeRepo
            .update(fb.tradeId, {
              status: 'CLOSED',
              exitReason: `MT5_${fb.status}`,
              pnlUsd: 0,
              pnlPoints: 0,
              pnlPercent: 0,
              result: 'BREAKEVEN',
            })
            .catch(() => {});
        }
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
    // ── CANDADO ESTRICTO: Nunca enviar aperturas automáticas que no sean Crash o Boom ──
    if (cmd.action === 'OPEN' && cmd.comment !== 'MANUAL_APP' && !this.isAllowedCrashBoomSymbol(cmd.symbol || '')) {
      this.logger.warn(
        `⛔ [MT5 BLOQUEADO SOLO CRASH/BOOM] Comando OPEN descartado para símbolo no permitido: ${cmd.symbol || ''}.`,
      );
      return;
    }

    // ── REGLA: Solo enviar aperturas automáticas a MT5 si el usuario autorizado (weimarsuber@gmail.com) está conectado ──
    if (cmd.action === 'OPEN' && cmd.comment !== 'MANUAL_APP') {
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

    // 1. Encolar también en memoria para bridge HTTP (si se usa mt5_bridge_client.js remoto)
    if (command.action === 'OPEN' && command.tradeId) {
      const alreadyQueued = this.pendingMt5Commands.some(
        (pending) => pending.action === 'OPEN' && pending.tradeId === command.tradeId,
      );
      if (!alreadyQueued) {
        this.pendingMt5Commands.push(command);
      }
    } else {
      this.pendingMt5Commands.push(command);
    }

    // 2. Si la carpeta local de MT5 existe en este equipo, escribir directamente en deriv_bridge_commands.json
    if (!fs.existsSync(this.mt5FilesDir)) {
      // eslint-disable-next-line no-console
      console.log(
        `📡 [MT5 BRIDGE -> COLA HTTP] Comando ${cmd.action} listo para MT5: ${cmd.symbol} ${cmd.direction || ''} (Lote: ${cmd.lot || '-'}, SL: ${cmd.stopLossPrice ?? 0}, TP: ${cmd.takeProfitPrice ?? 0})`,
      );
      this.logger.log(
        `📡 [MT5 BRIDGE] Comando ${cmd.action} encolado para bridge HTTP (${cmd.symbol} ${cmd.direction || ''}).`,
      );
      return;
    }

    let attempts = 3;
    while (attempts > 0) {
      try {
        const line = JSON.stringify(command) + '\n';
        fs.appendFileSync(this.mt5CommandsFile, line, 'utf8');

        // eslint-disable-next-line no-console
        console.log(
          `📡 [MT5 BRIDGE -> ARCHIVO MT5] Comando ${cmd.action} escrito en ${this.mt5CommandsFile} -> ${cmd.symbol} ${cmd.direction || ''} (Lote: ${cmd.lot || '-'}, SL: ${cmd.stopLossPrice ?? 0}, TP: ${cmd.takeProfitPrice ?? 0}, Ticket: ${cmd.ticket || 'NUEVO'})`,
        );
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
        if (content && content.length > 0) {
          await this.handleMt5Feedback(content);
          try {
            fs.writeFileSync(this.mt5FeedbackFile, '', 'utf8');
          } catch {}
        }
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
              symbol: this.toMt5Symbol(trade.symbol),
              direction: trade.direction,
              entryPrice: trade.entryPrice,
              stopLossPrice: 0,
              takeProfitPrice: 0,
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

      // 4. Sincronización de HISTORIAL REAL de transacciones cerradas (solo si el archivo cambió en disco)
      if (fs.existsSync(this.mt5HistoryFile)) {
        try {
          const histStat = fs.statSync(this.mt5HistoryFile);
          if (histStat.mtimeMs !== this.lastProcessedHistMtime) {
            this.lastProcessedHistMtime = histStat.mtimeMs;
            const histContent = fs.readFileSync(this.mt5HistoryFile, 'utf8');
            if (histContent && histContent.trim().startsWith('[')) {
              const rawDeals = JSON.parse(histContent);
              if (Array.isArray(rawDeals)) {
                await this.processMt5HistorySync(rawDeals);
              }
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

      const normSym = (str: string) => this.normalizeSymbol(str);

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
            if (mt5Pos.profit > (trade.maxProfitUsd || 0)) {
              trade.maxProfitUsd = mt5Pos.profit;
              void this.tradeRepo.update(trade.id, {
                maxProfitUsd: trade.maxProfitUsd,
                maxProfitPoints: trade.maxProfitPoints || 0,
              }).catch(() => {});
            }

            // Si en MT5 el trade alcanza ganancia de spike (>= $1.50 USD), registrar el spike
            if (mt5Pos.profit >= 1.50 && this.getAssetCategory(trade.symbol) === 'CRASH_BOOM') {
              trade.hadSpike = true;
              const prevTradeSpike = this.tradeLastSpikeTime.get(trade.id) || 0;
              if (!prevTradeSpike || (Date.now() - prevTradeSpike > 15_000 && mt5Pos.profit >= (trade.maxProfitUsd || 0))) {
                this.tradeLastSpikeTime.set(trade.id, Date.now());
                this.lastSpikeAt.set(trade.symbol, Date.now());
              }
              void this.tradeRepo.update(trade.id, {
                hadSpike: true,
                maxProfitUsd: trade.maxProfitUsd || 0,
              }).catch(() => {});
            }

            // ── GESTIÓN VIRTUAL DE TP, SL MONETARIO Y TRAILING SEGÚN CATEGORÍA EN MT5 SYNC ──
            const cat = this.getAssetCategory(trade.symbol);
            const curProfit = Number(mt5Pos.profit) || 0;
            const peakUsd = Math.max(trade.maxProfitUsd || 0, trade.maxProfitPoints || 0);

            // 0) TP Virtual (omitir en Crash y Boom para permitir continuidad de múltiples spikes)
            if (cat !== 'CRASH_BOOM' && trade.takeProfitPrice && trade.takeProfitPrice > 0 && mt5Pos.currentPrice > 0) {
              const hitTp =
                trade.direction === 'BUY'
                  ? mt5Pos.currentPrice >= trade.takeProfitPrice
                  : mt5Pos.currentPrice <= trade.takeProfitPrice;
              if (hitTp && curProfit > 0) {
                this.logger.log(
                  `🎯 [MT5 VIRTUAL TP] ${trade.symbol} (Ticket #${trade.mt5Ticket}) alcanzó TP virtual ${trade.takeProfitPrice} con +$${curProfit.toFixed(2)} USD. Cerrando.`,
                );
                await this.closeTrade(trade.id, 'VIRTUAL_TP_REACHED', mt5Pos.currentPrice);
                continue;
              }
            }

            if (cat === 'CRASH_BOOM') {
              // Trailing Stop amplio 25% solo cuando profit > 8 USD (piso mín $2 USD) para continuidad de spikes
                            // Trailing Stop Inteligente Escalonado para Crash y Boom
              if (peakUsd >= 8.0) {
                const ratio = peakUsd >= 30.0 ? 0.70 : peakUsd >= 15.0 ? 0.60 : 0.50;
                const floorVal = Math.max(4.0, Number((peakUsd * ratio).toFixed(2)));
                if (curProfit <= floorVal) {
                  this.logger.log(
                    `🔒 [MT5 TRAILING ${(ratio * 100).toFixed(0)}% CRASH/BOOM] ${trade.symbol} (Ticket #${trade.mt5Ticket}) pico +${peakUsd.toFixed(2)} USD -> actual +${curProfit.toFixed(2)} USD (piso asegurado: +${floorVal} USD). Cerrando.`,
                  );
                  await this.closeTrade(trade.id, `TRAILING_${(ratio * 100).toFixed(0)}PCT_CRASH_BOOM`, mt5Pos.currentPrice);
                  continue;
                }
              }
            } else if (cat === 'SYNTHETIC_OTHER') {
              // Step, Jump, Volatility: SL 7 USD y asegurar 50% solo si profit > 8 USD
              if (curProfit <= -7.0) {
                this.logger.log(
                  `🛑 [MT5 SL -7 USD SINTÉTICO] ${trade.symbol} (Ticket #${trade.mt5Ticket}) pérdida $${curProfit.toFixed(2)} USD <= -7 USD. Cerrando.`,
                );
                await this.closeTrade(trade.id, 'SL_MAX_7USD_SYNTHETIC', mt5Pos.currentPrice);
                continue;
              }
              if (peakUsd > 8.0) {
                const floor50 = Number((peakUsd * 0.50).toFixed(2));
                if (curProfit <= floor50) {
                  this.logger.log(
                    `🔒 [MT5 TRAILING 50% SINTÉTICO > $8 USD] ${trade.symbol} (Ticket #${trade.mt5Ticket}) pico +$${peakUsd.toFixed(2)} USD -> actual +$${curProfit.toFixed(2)} USD (piso 50%: +$${floor50} USD). Cerrando.`,
                  );
                  await this.closeTrade(trade.id, 'TRAILING_50PCT_SYNTHETIC', mt5Pos.currentPrice);
                  continue;
                }
              }
            } else if (cat === 'FOREX_METALS') {
              // Forex y Metales: SL 8 USD y asegurar 60% cuando profit > 8 USD esperando TP
              if (curProfit <= -8.0) {
                this.logger.log(
                  `🛑 [MT5 SL -8 USD FOREX] ${trade.symbol} (Ticket #${trade.mt5Ticket}) pérdida $${curProfit.toFixed(2)} USD <= -8 USD. Cerrando.`,
                );
                await this.closeTrade(trade.id, 'SL_MAX_8USD_FOREX', mt5Pos.currentPrice);
                continue;
              }
              if (peakUsd > 8.0) {
                const floor60 = Number((peakUsd * 0.60).toFixed(2));
                if (curProfit <= floor60) {
                  this.logger.log(
                    `🔒 [MT5 TRAILING 60% FOREX >$8] ${trade.symbol} (Ticket #${trade.mt5Ticket}) pico +$${peakUsd.toFixed(2)} USD -> actual +$${curProfit.toFixed(2)} USD (piso 60%: +$${floor60} USD). Cerrando.`,
                  );
                  await this.closeTrade(trade.id, 'TRAILING_60PCT_FOREX_OVER_8USD', mt5Pos.currentPrice);
                  continue;
                }
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

      // ── RASTREO Y PROTECCIÓN GLOBAL POR TICKET EN MT5 (solo posiciones del bot Magic 999888) ──
      for (const pos of rawPositions) {
        if (Number(pos.magic) !== 999888) continue;
        const tKey = String(pos.ticket);
        const cat = this.getAssetCategory(pos.symbol);

        const curProfit = Number(pos.profit) || 0;
        const prevMax = this.mt5TrackedMaxProfit.get(tKey) || 0;

        if (curProfit > prevMax) {
          this.mt5TrackedMaxProfit.set(tKey, curProfit);
        }

        const peak = this.mt5TrackedMaxProfit.get(tKey) || 0;
        let shouldClose = false;
        let closeReason = '';

        if (cat === 'CRASH_BOOM' && peak >= 8.0) {
          const ratio = peak >= 30.0 ? 0.70 : peak >= 15.0 ? 0.60 : 0.50;
          const floorVal = Math.max(4.0, Number((peak * ratio).toFixed(2)));
          if (curProfit <= floorVal) {
            shouldClose = true;
            closeReason = `TRAILING_${(ratio * 100).toFixed(0)}PCT_CRASH_BOOM`;
          }
        } else if (cat === 'SYNTHETIC_OTHER') {
          if (curProfit <= -7.0) {
            shouldClose = true;
            closeReason = 'SL_MAX_7USD_SYNTHETIC';
          } else if (peak > 8.0 && curProfit <= Number((peak * 0.50).toFixed(2))) {
            shouldClose = true;
            closeReason = 'TRAILING_50PCT_SYNTHETIC';
          }
        } else if (cat === 'FOREX_METALS') {
          if (curProfit <= -8.0) {
            shouldClose = true;
            closeReason = 'SL_MAX_8USD_FOREX';
          } else if (peak > 8.0 && curProfit <= Number((peak * 0.60).toFixed(2))) {
            shouldClose = true;
            closeReason = 'TRAILING_60PCT_FOREX_OVER_8USD';
          }
        }

        if (shouldClose) {
          this.logger.log(
            `🛡️ [MT5 DIRECT PROTECT] Posición #${tKey} (${pos.symbol}) [${closeReason}] Pico: +$${peak.toFixed(2)} USD | Actual: $${curProfit.toFixed(2)} USD. Enviando cierre a MT5.`,
          );
          await this.sendMt5Command({
            id: `cmd_protect_${randomUUID().slice(0, 8)}`,
            action: 'CLOSE',
            ticket: Number(pos.ticket),
            symbol: pos.symbol,
            reason: closeReason,
            status: 'PENDING',
          });
          this.mt5TrackedMaxProfit.delete(tKey);
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
        if (this.processedHistoryDeals.has(dealTicketStr)) continue;
        this.processedHistoryDeals.add(dealTicketStr);

        const existing = await this.tradeRepo.findOne({
          where: [
            { mt5Ticket: dealTicketStr },
            { mt5Ticket: String(deal.dealTicket) },
            { mt5Ticket: String(deal.orderTicket) },
          ],
        });

        const pnlUsd = Number((deal.netProfit !== undefined ? deal.netProfit : deal.profit).toFixed(2));
        const result = pnlUsd > 0.05 ? 'WIN' : pnlUsd < -0.05 ? 'LOSS' : 'BREAKEVEN';

        const dealCloseSec = Number(deal.closeTime) || 0;
        const dealCloseMs = dealCloseSec > 1e11 ? dealCloseSec : dealCloseSec * 1000;
        const isRecent = dealCloseMs > 0 && Date.now() - dealCloseMs < this.GOLD_SL_COOLDOWN_MS;

        if (this.getBucket(deal.symbol) === 'XAUUSD' && pnlUsd < -0.05 && isRecent) {
          if (dealCloseMs > this.lastGoldSlExitAt) {
            this.lastGoldSlExitAt = dealCloseMs;
            this.logger.warn(
              `🛑 [MT5 SL ORO HISTORIAL] Deal #${dealTicketStr} de Oro cerró con pérdida ($${pnlUsd} USD). Cooldown de 10 min activado.`,
            );
          }
        }

        // ── REGLA USUARIO: Cooldown de 30 minutos tras salir en SL / pérdida en el mismo índice ──
        if (pnlUsd < -0.05 && dealCloseMs > 0 && Date.now() - dealCloseMs < this.SYMBOL_SL_COOLDOWN_MS) {
          const normDealSym = this.normalizeSymbol(deal.symbol);
          if (dealCloseMs > (this.lastSymbolSlExitAt.get(normDealSym) || 0)) {
            this.lastSymbolSlExitAt.set(normDealSym, dealCloseMs);
            this.lastSymbolSlExitAt.set(deal.symbol, dealCloseMs);
            this.lastSymbolTradeResult.set(normDealSym, 'LOSS');
            this.logger.warn(
              `🛑 [MT5 SL HISTORIAL - COOLDOWN 30 MIN] Deal #${dealTicketStr} de ${normDealSym} cerró con pérdida ($${pnlUsd} USD). Cooldown de 30 min activado para este índice.`,
            );
          }
        }

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

            const currentHourEpoch = Math.floor(Date.now() / 3_600_000);
            const dealHourEpoch = dealCloseMs > 0 ? Math.floor(dealCloseMs / 3_600_000) : currentHourEpoch;
            if (
              dealHourEpoch === currentHourEpoch &&
              this.isAllowedCrashBoomSymbol(existing.symbol) &&
              Number(existing.entryPrice) > 0
            ) {
              const normSym = this.normalizeSymbol(existing.symbol);
              this.sameHourReentryZones.set(normSym, {
                symbol: existing.symbol,
                normSym,
                direction: existing.direction,
                strategy: existing.strategy,
                entryPrice: Number(existing.entryPrice),
                stopLossPrice: existing.stopLossPrice ? Number(existing.stopLossPrice) : null,
                exitPrice: Number(deal.closePrice || existing.entryPrice),
                exitReason: existing.exitReason || 'MT5_CLOSED',
                exitTimeMs: dealCloseMs > 0 ? dealCloseMs : Date.now(),
                hourEpoch: currentHourEpoch,
              });
            }
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
    return this.normalizeSymbol(symA) === this.normalizeSymbol(symB);
  }

  getDefaultLotForSymbol(sym: string): number {
    const cat = this.getAssetCategory(sym);
    if (cat === 'FOREX_METALS') {
      return 0.05;
    }
    if (cat === 'SYNTHETIC_OTHER') {
      return 0.10;
    }

    const s = (sym || '').toUpperCase().replace(/\s+/g, '');
    if (s.includes('CRASH600') || s.includes('C600')) {
      return 0.25;
    }
    if (
      s.includes('CRASH300') || s.includes('C300') ||
      s.includes('CRASH900') || s.includes('C900') ||
      s.includes('BOOM1000') || s.includes('B1000')
    ) {
      return 0.50;
    }

    return 1.00;
  }

  /**
   * Lote mínimo permitido por el broker (Deriv MT5) para índices Crash/Boom.
   * Usado al reducir el lote para que el SL técnico quepa dentro del SL monetario.
   * NOTA: verificar contra la especificación del símbolo en MT5 (Volumen mínimo).
   */
  getMinLotForSymbol(sym: string): number {
    const s = (sym || '').toUpperCase().replace(/\s+/g, '');
    if (s.includes('CRASH300') || s.includes('C300')) return 0.5;
    if (s.includes('BOOM300') || s.includes('B300')) return 1.0;
    return 0.2;
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

  /**
   * REGLA USUARIO: Evalúa si al transcurrir una hora se está en déficit o pérdida neta acumulada.
   * Si hay déficit, activa una pausa de 1 hora para todos los trades normales,
   * permitiendo únicamente entradas clasificadas como MUY VIABLES (isHighlyViable = true).
   */
  async checkHourlyPerformance(): Promise<{ netHourlyPnl: number; isDeficit: boolean; pauseUntil: number }> {
    try {
      const oneHourAgoSec = Math.floor((Date.now() - 3600_000) / 1000);
      const trades = await this.tradeRepo
        .createQueryBuilder('trade')
        .where('trade.status = :status', { status: 'CLOSED' })
        .andWhere('trade.exitTime >= :oneHourAgoSec', { oneHourAgoSec })
        .getMany();

      const netHourlyPnl = Number(trades.reduce((acc, t) => acc + (Number(t.pnlUsd) || 0), 0).toFixed(2));
      const isDeficit = trades.length > 0 && netHourlyPnl < -0.05;

      if (isDeficit) {
        if (Date.now() >= this.hourlyDeficitPauseUntil) {
          this.hourlyDeficitPauseUntil = Date.now() + 3600_000;
          this.logger.warn(
            `🛑 [DÉFICIT HORARIO DETECTADO] Pérdida neta de la última hora: $${netHourlyPnl.toFixed(2)} USD (${trades.length} trades cerrados). Activando pausa de 1 hora para trades generales (hasta ${new Date(this.hourlyDeficitPauseUntil).toLocaleTimeString()}). Solo se permitirán entradas MUY VIABLES.`,
          );
        }
      }
      return { netHourlyPnl, isDeficit, pauseUntil: this.hourlyDeficitPauseUntil };
    } catch (e: any) {
      this.logger.debug(`Error al evaluar rendimiento horario: ${e?.message}`);
      return { netHourlyPnl: 0, isDeficit: false, pauseUntil: this.hourlyDeficitPauseUntil };
    }
  }
}
