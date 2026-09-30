import { Injectable, Logger } from '@nestjs/common';
import { SignalsService, SignalResult, CRASH_BOOM_KNOWN_SYMBOLS } from '../signals/signals.service';
import { ApexSignalsService, ApexSignal } from './apex-signals.service';

// ─── Wey Signal Types ─────────────────────────────────────────────────────────

export interface WeySignal {
  symbol: string;
  mercado: string;
  direccion: 'COMPRA' | 'VENTA' | string;
  estrellas: number;
  rb: number;
  recorrido: string;
  entrada: number;
  sl: number;
  tp: number;
  sesgo: string;
  fuente: 'WEY';
  rsi: number;
  macd: number;
  atr: number;
  alignment: string;
  alignmentDetail?: Record<string, string>;
  macroTrend: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL';
  macroTrendOk: boolean;
  macroTrendH4?: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL';
  macroTrendH4Ok?: boolean;
  structureOk: boolean;
  candlesSinceLastSpike: number;
  avgReactionCandles: number;
  viable: boolean;
  viabilityReason: string;
  historyContext?: SignalResult['historyContext'];
  historicalReactionFrames?: number;
  capturedAt: string;
}

export interface WeyComparisonMatch {
  directionMatch: boolean;
  starsWey: number;
  starsApex: number | null;
  rbWey: number;
  rbApex: number | null;
  entryDiffPct: number | null;
  strongMatch: boolean;
}

export interface WeyComparisonRow {
  symbol: string;
  wey: WeySignal | null;
  apex: ApexSignal | null;
  match: WeyComparisonMatch;
}

export interface WeyComparisonResult {
  rows: WeyComparisonRow[];
  summary: {
    total: number;
    withApex: number;
    directionMatches: number;
    strongMatches: number;
    viableCount: number;
    nextEvaluationAt: string;
    computedAt: string;
  };
}

// ─── Human readable market names ─────────────────────────────────────────────

function toMarketName(symbol: string): string {
  const up = symbol.toUpperCase();
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

// ─── Evaluación dos minutos antes de cada cuarto (:13, :28, :43, :58) ────────

export function getNextQuarterHourInfo(): { nextDate: Date; msRemaining: number; nextIso: string } {
  const now = new Date();
  const nextDate = new Date(now);
  const evaluationMinutes = [13, 28, 43, 58];
  const nextMinute = evaluationMinutes.find((minute) => minute > now.getMinutes());

  if (nextMinute === undefined) {
    nextDate.setHours(now.getHours() + 1, evaluationMinutes[0], 0, 0);
  } else {
    nextDate.setMinutes(nextMinute, 0, 0);
  }
  const msRemaining = Math.max(1000, nextDate.getTime() - now.getTime());
  return { nextDate, msRemaining, nextIso: nextDate.toISOString() };
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class WeySignalsService {
  private readonly logger = new Logger(WeySignalsService.name);

  private cachedSignals: WeySignal[] = [];
  private cachedComparison: WeyComparisonResult | null = null;
  private cacheExpiresAt: number = 0;
  private ongoingPromise: Promise<WeyComparisonResult> | null = null;

  constructor(
    private readonly signalsSvc: SignalsService,
    private readonly apexSvc: ApexSignalsService,
  ) {}

  /**
   * Obtiene las señales calculadas localmente por el motor Wey,
   * ordenadas estrictamente por número de estrellas de mayor a menor (4★ → 3★).
   * Por defecto filtra y devuelve SOLO las señales VIABLES.
   */
  async getSignals(
    minStars: number = 0,
    onlyViable: boolean = true,
  ): Promise<{ signals: WeySignal[]; lastUpdated: string; nextEvaluationAt: string }> {
    const comp = await this.compare();
    const signals = comp.rows
      .map((r) => r.wey)
      .filter((w): w is WeySignal => {
        if (!w) return false;
        if (w.estrellas < minStars) return false;
        if (onlyViable && !w.viable) return false;
        return true;
      })
      .sort((a, b) => {
        // 1. Ordenar por estrellas de mayor a menor
        if (b.estrellas !== a.estrellas) {
          return b.estrellas - a.estrellas;
        }
        // 2. Si empatan en estrellas, por mayor R:B
        if (b.rb !== a.rb) {
          return b.rb - a.rb;
        }
        // 3. Alfabético por mercado
        return a.mercado.localeCompare(b.mercado);
      });

    return {
      signals,
      lastUpdated: comp.summary.computedAt,
      nextEvaluationAt: comp.summary.nextEvaluationAt,
    };
  }

  /**
   * Compara en tiempo real las señales Wey (locales) contra las señales de Apex,
   * sincronizado dos minutos antes de las ventanas (:13, :28, :43, :58).
   */
  async compare(force: boolean = false): Promise<WeyComparisonResult> {
    const now = Date.now();
    if (!force && this.cachedComparison && now < this.cacheExpiresAt) {
      return this.cachedComparison;
    }

    if (this.ongoingPromise) {
      return this.ongoingPromise;
    }

    this.ongoingPromise = this.doComputeAndCompare().finally(() => {
      this.ongoingPromise = null;
    });

    return this.ongoingPromise;
  }

  private async doComputeAndCompare(): Promise<WeyComparisonResult> {
    const computedAt = new Date().toISOString();

    // ── 1. Calcular señales locales Wey ──────────────────────────────────────
    const weyMap = new Map<string, WeySignal>();

    await Promise.allSettled(
      CRASH_BOOM_KNOWN_SYMBOLS.map(async (symbol) => {
        try {
          const result: SignalResult = await this.signalsSvc.getSignal(symbol, 300);
          const weySignal = this.toWeySignal(result, computedAt);
          weyMap.set(symbol.toUpperCase(), weySignal);
        } catch (err: any) {
          this.logger.warn(`Error calculando señal Wey para ${symbol}: ${err?.message ?? err}`);
        }
      }),
    );

    // ── 2. Obtener señales de referencia de Apex ─────────────────────────────
    const { signals: apexSignals } = this.apexSvc.getSignals();
    const apexMap = new Map<string, ApexSignal>();
    for (const s of apexSignals) {
      if (!s.mercado) continue;
      const key = s.mercado.toUpperCase().replace(/\s+/g, '');
      if (!apexMap.has(key) || s.fuente === 'RADAR') {
        apexMap.set(key, s);
      }
    }

    // ── 3. Construir filas y ordenar por estrellas Wey de mayor a menor ───────
    const rows: WeyComparisonRow[] = CRASH_BOOM_KNOWN_SYMBOLS.map((symbol) => {
      const key = symbol.toUpperCase();
      const wey = weyMap.get(key) ?? null;
      const apex = apexMap.get(key) ?? null;
      const match = this.buildMatch(wey, apex);
      return { symbol: key, wey, apex, match };
    }).sort((a, b) => {
      const starsA = a.wey?.estrellas ?? 0;
      const starsB = b.wey?.estrellas ?? 0;
      if (starsB !== starsA) return starsB - starsA;
      const rbA = a.wey?.rb ?? 0;
      const rbB = b.wey?.rb ?? 0;
      return rbB - rbA;
    });

    // ── 4. Resumen y siguiente evaluación anticipada (:13, :28, :43) ──
    const withApex = rows.filter((r) => r.apex !== null).length;
    const directionMatches = rows.filter((r) => r.match.directionMatch).length;
    const strongMatches = rows.filter((r) => r.match.strongMatch).length;
    const viableCount = rows.filter((r) => r.wey?.viable).length;
    const qInfo = getNextQuarterHourInfo();

    const result: WeyComparisonResult = {
      rows,
      summary: {
        total: rows.length,
        withApex,
        directionMatches,
        strongMatches,
        viableCount,
        nextEvaluationAt: qInfo.nextIso,
        computedAt,
      },
    };

    this.cachedComparison = result;
    this.cachedSignals = rows.map((r) => r.wey).filter((w): w is WeySignal => w !== null);
    // La caché se mantiene válida hasta la próxima evaluación anticipada.
    this.cacheExpiresAt = qInfo.nextDate.getTime();

    return result;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private toWeySignal(r: SignalResult, capturedAt: string): WeySignal {
    const market = toMarketName(r.symbol);
    const sesgo =
      r.alignment === 'ALINEADO'
        ? r.direction === 'VENTA' ? 'ALINEADO BAJISTA' : 'ALINEADO ALCISTA'
        : r.alignment === 'PARCIAL'
        ? r.direction === 'VENTA' ? 'SESGO BAJISTA (PARCIAL)' : 'SESGO ALCISTA (PARCIAL)'
        : 'SIN ALINEACIÓN (MEZCLADO)';

    return {
      symbol: r.symbol,
      mercado: market,
      direccion: r.direction,
      estrellas: r.stars,
      rb: r.rb,
      recorrido: `${r.recorrido}%`,
      entrada: r.entry,
      sl: r.sl,
      tp: r.tp,
      sesgo,
      fuente: 'WEY',
      rsi: r.rsi,
      macd: r.macd,
      atr: r.atr,
      alignment: r.alignment,
      alignmentDetail: r.alignmentDetail,
      macroTrend: r.macroTrend,
      macroTrendOk: r.macroTrendOk,
      macroTrendH4: r.macroTrendH4,
      macroTrendH4Ok: r.macroTrendH4Ok,
      structureOk: r.structureOk,
      candlesSinceLastSpike: r.candlesSinceLastSpike,
      avgReactionCandles: r.avgReactionCandles,
      viable: r.viable,
      viabilityReason: r.viabilityReason,
      historyContext: r.historyContext,
      historicalReactionFrames: r.historicalReactionFrames,
      capturedAt,
    };
  }

  private buildMatch(wey: WeySignal | null, apex: ApexSignal | null): WeyComparisonMatch {
    const starsWey = wey?.estrellas ?? 0;
    const starsApex = apex?.estrellas ?? null;
    const rbWey = wey?.rb ?? 0;
    const rbApex = apex?.rb ?? null;

    const weyDir = wey?.direccion ?? null;
    const apexDir = apex?.direccion ?? null;

    const directionMatch = !!(weyDir && apexDir && weyDir === apexDir);

    const entryDiffPct =
      wey?.entrada && apex?.entrada && apex.entrada > 0
        ? parseFloat((((wey.entrada - apex.entrada) / apex.entrada) * 100).toFixed(4))
        : null;

    const strongMatch = directionMatch && starsApex !== null && starsWey >= starsApex;

    return { directionMatch, starsWey, starsApex, rbWey, rbApex, entryDiffPct, strongMatch };
  }
}
