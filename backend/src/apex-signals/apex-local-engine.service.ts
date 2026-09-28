import { Injectable, Logger } from '@nestjs/common';
import { SignalsService, SignalResult, CRASH_BOOM_KNOWN_SYMBOLS } from '../signals/signals.service';
import { ApexSignalsService, ApexSignal } from './apex-signals.service';

// ─── Output Types ─────────────────────────────────────────────────────────────

export interface LocalComputed {
  symbol: string;
  direction: 'COMPRA' | 'VENTA' | 'NEUTRAL';
  stars: number;
  entry: number;
  sl: number;
  tp: number;
  rb: number;
  recorrido: number;
  rsi: number;
  macd: number;
  atr: number;
  alignment: string;
  alignmentDetail: Record<string, string>;
  insufficientData: boolean;
  computedAt: string;
}

export interface ComparisonMatch {
  directionMatch: boolean;
  starsLocal: number;
  starsApex: number | null;
  rbLocal: number;
  rbApex: number | null;
  /** % difference between entry prices, null if no apex data */
  entryDiffPct: number | null;
  /** true if both direction AND stars are aligned */
  strongMatch: boolean;
}

export interface ComparisonRow {
  symbol: string;
  local: LocalComputed | null;
  apex: ApexSignal | null;
  match: ComparisonMatch;
}

export interface ComparisonResult {
  rows: ComparisonRow[];
  summary: {
    total: number;
    withApex: number;
    directionMatches: number;
    strongMatches: number;
    computedAt: string;
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ApexLocalEngineService {
  private readonly logger = new Logger(ApexLocalEngineService.name);

  private cachedResult: ComparisonResult | null = null;
  private cacheExpiresAt: number = 0;
  private ongoingPromise: Promise<ComparisonResult> | null = null;

  constructor(
    private readonly signalsSvc: SignalsService,
    private readonly apexSvc: ApexSignalsService,
  ) {}

  /**
   * Computes local signals for all known crash/boom symbols and compares
   * them against the Apex-provided signals (cached in ApexSignalsService).
   * Cached in memory for 15 seconds to avoid repeated heavy DB queries.
   */
  async compare(): Promise<ComparisonResult> {
    const now = Date.now();
    if (this.cachedResult && now < this.cacheExpiresAt) {
      return this.cachedResult;
    }

    if (this.ongoingPromise) {
      return this.ongoingPromise;
    }

    this.ongoingPromise = this.doCompare().finally(() => {
      this.ongoingPromise = null;
    });

    return this.ongoingPromise;
  }

  private async doCompare(): Promise<ComparisonResult> {
    const computedAt = new Date().toISOString();

    // ── 1. Compute all local signals ─────────────────────────────────────────
    const localMap = new Map<string, LocalComputed>();

    await Promise.allSettled(
      CRASH_BOOM_KNOWN_SYMBOLS.map(async (symbol) => {
        try {
          const result: SignalResult = await this.signalsSvc.getSignal(symbol, 60);
          localMap.set(symbol.toUpperCase(), this.toLocal(result));
        } catch (err: any) {
          this.logger.warn(`Error calculando señal local para ${symbol}: ${err?.message ?? err}`);
        }
      }),
    );

    // ── 2. Get apex signals ────────────────────────────────────────────────
    const { signals: apexSignals } = this.apexSvc.getSignals();

    // Index apex signals by normalized symbol name (uppercase, no spaces)
    const apexMap = new Map<string, ApexSignal>();
    for (const s of apexSignals) {
      if (!s.mercado) continue;
      const key = s.mercado.toUpperCase().replace(/\s+/g, '');
      // Prefer RADAR signals (more data) over CARTOGRAFO when duplicated
      if (!apexMap.has(key) || s.fuente === 'RADAR') {
        apexMap.set(key, s);
      }
    }

    // ── 3. Build comparison rows ─────────────────────────────────────────────
    const rows: ComparisonRow[] = CRASH_BOOM_KNOWN_SYMBOLS.map((symbol) => {
      const key   = symbol.toUpperCase();
      const local = localMap.get(key) ?? null;
      const apex  = apexMap.get(key) ?? null;

      const match = this.buildMatch(local, apex);
      return { symbol: key, local, apex, match };
    });

    // ── 4. Summary ──────────────────────────────────────────────────────────
    const withApex        = rows.filter((r) => r.apex !== null).length;
    const directionMatches = rows.filter((r) => r.match.directionMatch).length;
    const strongMatches    = rows.filter((r) => r.match.strongMatch).length;

    this.logger.debug(
      `compare(): ${rows.length} símbolos | ${withApex} con Apex | ` +
      `${directionMatches} dirección OK | ${strongMatches} match fuerte`,
    );

    const result: ComparisonResult = {
      rows,
      summary: {
        total:            rows.length,
        withApex,
        directionMatches,
        strongMatches,
        computedAt,
      },
    };

    this.cachedResult = result;
    this.cacheExpiresAt = Date.now() + 15_000; // 15s cache

    return result;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private toLocal(r: SignalResult): LocalComputed {
    return {
      symbol:          r.symbol,
      direction:       r.direction,
      stars:           r.stars,
      entry:           r.entry,
      sl:              r.sl,
      tp:              r.tp,
      rb:              r.rb,
      recorrido:       r.recorrido,
      rsi:             r.rsi,
      macd:            r.macd,
      atr:             r.atr,
      alignment:       r.alignment,
      alignmentDetail: r.alignmentDetail,
      insufficientData: r.insufficientData,
      computedAt:      r.computedAt,
    };
  }

  private buildMatch(local: LocalComputed | null, apex: ApexSignal | null): ComparisonMatch {
    const starsLocal  = local?.stars  ?? 0;
    const starsApex   = apex?.estrellas ?? null;
    const rbLocal     = local?.rb     ?? 0;
    const rbApex      = apex?.rb      ?? null;

    const localDir = local?.direction ?? null;
    const apexDir  = apex?.direccion  ?? null;

    const directionMatch = !!(localDir && apexDir && localDir === apexDir);

    const entryDiffPct =
      local?.entry && apex?.entrada && apex.entrada > 0
        ? parseFloat((((local.entry - apex.entrada) / apex.entrada) * 100).toFixed(4))
        : null;

    const strongMatch = directionMatch && starsApex !== null && starsLocal >= starsApex;

    return { directionMatch, starsLocal, starsApex, rbLocal, rbApex, entryDiffPct, strongMatch };
  }
}
