import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { WatchedEntryLevel } from './watched-level.entity';
import { EvolutionCallService } from '../notifications/evolution-call.service';
import { TradingBotService } from '../trading/trading-bot.service';
import { TradeRecord } from '../trading/trade.entity';
import { CrashIaStrategyService, SYMBOL_DRIFT_PER_MIN } from '../strategies/crash-ia-strategy.service';

@Injectable()
export class WatchedLevelsService implements OnModuleInit {
  private readonly logger = new Logger(WatchedLevelsService.name);
  private readonly rearmedTradeIds = new Set<string>();
  private readonly lastGapEvaluationAt = new Map<string, number>();
  private isScanningGaps = false;

  private readonly CRASH_BOOM_SYMBOLS = [
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

  constructor(
    @InjectRepository(WatchedEntryLevel)
    private readonly levels: Repository<WatchedEntryLevel>,
    private readonly whatsapp: EvolutionCallService,
    private readonly trading: TradingBotService,
    private readonly crashIaService: CrashIaStrategyService,
  ) {}

  async onModuleInit() {
    // Liberar cualquier punto que haya quedado en 'EXECUTING' por reinicio previo o desconexión
    await this.levels.update(
      { status: 'EXECUTING' },
      { status: 'PENDING', evaluationReason: 'Restablecido al inicio. Esperando entrada 2 min antes en retroceso.' },
    );

    // Escaneo inicial de Gaps M1 recientes (últimos 7 días) y escaneo continuo cada 60s
    setTimeout(() => {
      void this.scanAndRegisterRecentM1Gaps(7);
    }, 5000);

    setInterval(() => {
      void this.scanAndRegisterRecentM1Gaps(1);
    }, 60_000);
  }

  /**
   * Detecta automáticamente dónde cada índice Crash/Boom presentó un Gap en M1
   * y lo registra en watched_entry_levels si aún no existe.
   */
  async scanAndRegisterRecentM1Gaps(daysBack = 1, minGapPoints = 1.5) {
    if (this.isScanningGaps) return;
    this.isScanningGaps = true;
    try {
      for (const targetSymbol of this.CRASH_BOOM_SYMBOLS) {
        const isBoom = targetSymbol.startsWith('BOOM');
        const direction: 'BUY' | 'SELL' = isBoom ? 'BUY' : 'SELL';
        const lot = this.suggestedLot(targetSymbol);
        const gapCondition = isBoom
          ? `(open - prev_close) >= ${minGapPoints}`
          : `(prev_close - open) >= ${minGapPoints}`;

        const gapQuery = `
          WITH ordered AS (
            SELECT epoch, open, high, low, close,
                   LAG(close) OVER (ORDER BY epoch) as prev_close,
                   LAG(epoch) OVER (ORDER BY epoch) as prev_epoch
            FROM candles
            WHERE symbol = $1 AND granularity = 60
              AND epoch >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '${daysBack} days'))
          )
          SELECT epoch,
                 to_timestamp(epoch) as fecha,
                 ROUND(prev_close::numeric, 3) as prev_close,
                 ROUND(open::numeric, 3) as open,
                 ROUND(ABS(open - prev_close)::numeric, 3) as gap_pts
          FROM ordered
          WHERE ${gapCondition}
            AND (epoch - prev_epoch) = 60
          ORDER BY epoch DESC
          LIMIT 40;
        `;

        const gaps: any[] = await this.levels.query(gapQuery, [targetSymbol]);
        if (!gaps || gaps.length === 0) continue;

        const existing = await this.levels.find({
          where: { symbol: targetSymbol },
          select: ['entryPrice'],
        });
        const existingPrices = existing.map((r) => Number(r.entryPrice));

        let newlyInserted = 0;
        for (const gap of gaps) {
          const entryPrice = Number(gap.prev_close);
          const gapSize = Number(gap.gap_pts);
          if (!Number.isFinite(entryPrice) || entryPrice <= 0) continue;

          const alreadyExists = existingPrices.some((p) => Math.abs(p - entryPrice) < 0.35);
          if (alreadyExists) continue;

          const dateObj = new Date(gap.fecha);
          const dateStr = dateObj.toISOString().replace('T', ' ').slice(0, 16);
          const note = `Gap M1 [${dateStr}] Base: ${entryPrice.toFixed(3)} -> Salto: ${Number(gap.open).toFixed(3)} (+${gapSize.toFixed(2)} pts)`;

          const created = this.levels.create({
            symbol: targetSymbol,
            direction,
            entryPrice,
            lot,
            multipleReactions: true,
            status: 'PENDING',
            note,
            backtesting: false,
            evaluationReason: 'Gap M1 detectado automáticamente. Esperando tendencia M15 + retroceso (entrada 2 min antes).',
          });
          await this.levels.save(created);
          existingPrices.push(entryPrice);
          newlyInserted++;
        }

        if (newlyInserted > 0) {
          this.logger.log(`📌 [GAP DETECTOR M1] ${targetSymbol}: ${newlyInserted} nuevo(s) Gap(s) registrado(s) para operar 2 min antes en retroceso.`);
        }
      }
    } catch (err: any) {
      this.logger.debug(`Error escaneando Gaps M1 automáticos: ${err?.message}`);
    } finally {
      this.isScanningGaps = false;
    }
  }

  @OnEvent('watched_level.trade_closed')
  async rearmAfterWatchedTrade(trade: TradeRecord) {
    if (!trade?.symbol || !trade.direction) return;
    if (this.rearmedTradeIds.has(trade.id)) return;
    this.rearmedTradeIds.add(trade.id);

    const levels = await this.levels.find({
      where: {
        direction: trade.direction,
        status: 'EXECUTED',
      },
    });

    for (const level of levels) {
      if (!this.trading.isSameSymbol(level.symbol, trade.symbol)) continue;
      if (Math.abs(Number(level.entryPrice) - Number(trade.entryPrice)) > 3) continue;

      await this.levels.update(level.id, {
        status: 'PENDING',
        evaluationReason: `Punto reactivado tras cierre de trade (${trade.exitReason || 'operación finalizada'}). Listo para nuevo retroceso.`,
      });
    }
  }

  @OnEvent('deriv.tick')
  async evaluateTick(tick: { symbol: string; quote: number }) {
    const rawSymbol = String(tick?.symbol || '').trim().toUpperCase();
    const price = Number(tick?.quote);
    if (!rawSymbol || !Number.isFinite(price)) return;

    const cleanSymbol = rawSymbol.replace(/[^A-Z0-9]/g, '');
    const normSymbol = this.trading.normalizeSymbol(rawSymbol);

    // ── EVALUACIÓN AUTOMÁTICA DE GAP SPIKE (ENTRADA Y ALERTA 2 MIN ANTES EN RETROCESO CON M15 A FAVOR) ──
    try {
      await this.evaluateGapSpikeAlerts(cleanSymbol, normSymbol, price);
    } catch (err: any) {
      this.logger.debug(`Error evaluando Gap 2 min antes para ${cleanSymbol}: ${err?.message}`);
    }

    const isOnline = await this.trading.isUserAuthorizedOnline();
    if (!isOnline) return;

    const levels = await this.levels
      .createQueryBuilder('lvl')
      .where('lvl.status IN (:...statuses)', { statuses: ['PENDING', 'EVALUATING', 'EXECUTED', 'EXECUTING'] })
      .andWhere(
        "(UPPER(lvl.symbol) = :rawSymbol OR UPPER(lvl.symbol) = :normSymbol OR REPLACE(UPPER(lvl.symbol), ' ', '') LIKE :cleanPattern OR :cleanSymbol LIKE CONCAT('%', REPLACE(UPPER(lvl.symbol), ' ', ''), '%'))",
        {
          rawSymbol,
          normSymbol,
          cleanSymbol,
          cleanPattern: `%${normSymbol}%`,
        },
      )
      .getMany();

    const drift = SYMBOL_DRIFT_PER_MIN[cleanSymbol] || 0.55;

    for (const level of levels) {
      const distance = Math.abs(price - level.entryPrice);
      const minutesToArrival = drift > 0 ? distance / drift : distance;
      const approaching = minutesToArrival <= 3.5;

      // ── CASO A: Recuperar puntos atascados en EXECUTING si pasaron > 30s sin respuesta ──
      if (level.status === 'EXECUTING') {
        const timeSinceUpdate = (Date.now() - new Date(level.updatedAt).getTime()) / 1000;
        if (timeSinceUpdate > 30) {
          await this.levels.update(level.id, {
            status: 'PENDING',
            evaluationReason: 'Punto liberado de ejecución tras tiempo de espera. Listo para evaluar 2 min antes en retroceso.',
          });
        }
        continue;
      }

      // ── CASO B: RE-ARMADO AUTOMÁTICO DE PUNTOS EJECUTADOS EN RETROCESO ──
      if (level.status === 'EXECUTED') {
        const nowSec = Math.floor(Date.now() / 1000);
        const timeSinceExec = nowSec - (level.executedAt || 0);
        if (distance > 3.5 && timeSinceExec >= 90) {
          await this.levels.update(level.id, {
            status: 'PENDING',
            evaluationReason: 'Punto rearmado: el precio se alejó de la zona. Listo para ejecutar 2 min antes al regresar en retroceso.',
          });
        }
        continue;
      }

      // ── CASO C: ACTUALIZAR ESTADO VISUAL EN APROXIMACIÓN (LA EJECUCIÓN SE HACE 2 MIN ANTES EN evaluateGapSpikeAlerts) ──
      if (!approaching && level.status === 'EVALUATING') {
        await this.levels.update(level.id, {
          status: 'PENDING',
          evaluationReason: 'Esperando que el precio regrese en retroceso hacia el Gap (entrada 2 min antes).',
        });
      }
    }
  }

  private suggestedLot(symbol: string): number {
    const value = (symbol || '').toUpperCase().replace(/\s+/g, '');
    return value.includes('CRASH600') ||
      value.includes('CRASH900') ||
      value.includes('BOOM600') ||
      value.includes('BOOM900') ||
      value.includes('BOOM1000')
      ? 0.5
      : 1;
  }

  list(filters: { symbol?: string; price?: number; minPrice?: number; maxPrice?: number }) {
    const where: any = {};
    if (filters.symbol) where.symbol = filters.symbol.trim().toUpperCase();
    if (Number.isFinite(filters.price)) where.entryPrice = filters.price;
    else if (Number.isFinite(filters.minPrice) && Number.isFinite(filters.maxPrice)) {
      where.entryPrice = Between(filters.minPrice, filters.maxPrice);
    }
    return this.levels.find({ where, order: { status: 'ASC', createdAt: 'DESC' } });
  }

  async create(input: Partial<WatchedEntryLevel>) {
    const symbol = String(input.symbol || '').trim().toUpperCase();
    const direction = input.direction;
    const entryPrice = Number(input.entryPrice);
    if (!symbol || !['BUY', 'SELL'].includes(direction || '') || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      throw new BadRequestException('Indice, direccion y precio de entrada valido son obligatorios.');
    }
    if (symbol.includes('CRASH') && direction !== 'SELL') throw new BadRequestException('Crash solo admite venta.');
    if (symbol.includes('BOOM') && direction !== 'BUY') throw new BadRequestException('Boom solo admite compra.');

    const duplicate = await this.levels.findOne({
      where: { symbol, entryPrice, status: 'PENDING' },
    });
    if (duplicate) {
      throw new BadRequestException('Ya existe un punto pendiente para este índice y este precio.');
    }

    return this.levels.save(this.levels.create({
      symbol,
      direction,
      entryPrice,
      lot: Number(input.lot) > 0 ? Number(input.lot) : this.suggestedLot(symbol),
      multipleReactions: input.multipleReactions === true,
      note: input.note?.trim() || null,
      status: 'PENDING',
    }));
  }

  async cancel(id: string) {
    const level = await this.levels.findOneByOrFail({ id });
    level.status = 'CANCELLED';
    level.evaluationReason = 'Cancelado por el usuario';
    return this.levels.save(level);
  }

  async setMultipleReactions(id: string, multipleReactions: boolean) {
    const level = await this.levels.findOneByOrFail({ id });
    level.multipleReactions = multipleReactions;
    return this.levels.save(level);
  }

  /**
   * Evalúa si el índice está en tendencia M15 a favor (Bullish para Boom / Bearish para Crash),
   * tiene un pequeño retroceso en M1 hacia la línea del Gap vigilado, y está a ~2 minutos antes
   * de llegar a la línea del Gap: envía alerta a Telegram y EJECUTA EL TRADE 2 MINUTOS ANTES
   * (permitiendo hasta una 2da entrada en ese mismo índice si ya hay una abierta).
   */
  private async evaluateGapSpikeAlerts(cleanSymbol: string, normSymbol: string, currentPrice: number) {
    const isBoom = cleanSymbol.includes('BOOM');
    const isCrash = cleanSymbol.includes('CRASH');
    if (!isBoom && !isCrash) return;

    // Throttling: evaluar gaps de este símbolo como máximo cada 1.5s
    const now = Date.now();
    const lastEval = this.lastGapEvaluationAt.get(cleanSymbol) || 0;
    if (now - lastEval < 1500) return;
    this.lastGapEvaluationAt.set(cleanSymbol, now);

    const targetDirection: 'BUY' | 'SELL' = isBoom ? 'BUY' : 'SELL';

    // 1. Obtener evaluación completa de la estrategia Crash & Boom IA (EMA50 M15 + Velas M1)
    let iaEval: any = null;
    try {
      iaEval = await this.crashIaService.evaluateSymbol(cleanSymbol);
    } catch (e: any) {
      this.logger.debug(`Error obteniendo evaluación IA para ${cleanSymbol}: ${e?.message}`);
      return;
    }

    if (!iaEval || !iaEval.filters) return;

    const ema50_M15 = Number(iaEval.filters.ema50_M15) || 0;
    const trendM15: 'ALCISTA' | 'BAJISTA' =
      iaEval.trendM15 ||
      (isBoom
        ? currentPrice >= ema50_M15
          ? 'ALCISTA'
          : 'BAJISTA'
        : currentPrice <= ema50_M15
          ? 'BAJISTA'
          : 'ALCISTA');
    const requiredTrend = isBoom ? 'ALCISTA' : 'BAJISTA';

    // ── REGLA CRÍTICA USUARIO: "el indice esta en tendencia" ──
    // BOOM (BUY) -> La tendencia M15 DEBE ser estrictamente ALCISTA (precio >= EMA50).
    // CRASH (SELL) -> La tendencia M15 DEBE ser estrictamente BAJISTA (precio <= EMA50).
    if (trendM15 !== requiredTrend || !iaEval.filters.trendOk) {
      return;
    }

    // ── REGLA CRÍTICA USUARIO: "y tiene un pequeño retroceso" ──
    // En BOOM: Mínimo 2 velas rojas M1 de retroceso hacia el soporte/Gap
    // En CRASH: Mínimo 2 velas verdes M1 de retroceso hacia la resistencia/Gap
    const consecutiveRetracementM1 = isBoom
      ? Number(iaEval.filters.consecutiveRedM1) || 0
      : Number(iaEval.filters.consecutiveGreenM1) || 0;

    if (consecutiveRetracementM1 < 2) {
      return;
    }

    // Buscar niveles vigilados pendientes con dirección correspondiente
    const candidateLevels = await this.levels
      .createQueryBuilder('lvl')
      .where('lvl.status IN (:...statuses)', { statuses: ['PENDING', 'EVALUATING'] })
      .andWhere('lvl.direction = :direction', { direction: targetDirection })
      .andWhere(
        "(UPPER(lvl.symbol) = :normSymbol OR REPLACE(UPPER(lvl.symbol), ' ', '') = :cleanSymbol OR :cleanSymbol LIKE CONCAT('%', REPLACE(UPPER(lvl.symbol), ' ', ''), '%'))",
        { normSymbol, cleanSymbol },
      )
      .getMany();

    if (!candidateLevels.length) return;

    // Deduplicar niveles por precio redondeado a 2 decimales para evitar procesar filas idénticas
    const seenPrices = new Set<string>();
    const uniqueCandidateLevels = candidateLevels.filter((lvl) => {
      const priceKey = Number(lvl.entryPrice).toFixed(2);
      if (seenPrices.has(priceKey)) return false;
      seenPrices.add(priceKey);
      return true;
    });

    const drift = SYMBOL_DRIFT_PER_MIN[cleanSymbol] || 0.55;
    const isOnline = await this.trading.isUserAuthorizedOnline();

    for (const level of uniqueCandidateLevels) {
      const gapPrice = Number(level.entryPrice);
      if (!Number.isFinite(gapPrice) || gapPrice <= 0) continue;

      const distance = Math.abs(currentPrice - gapPrice);

      // 1. CONDICIÓN: En Retroceso hacia la línea del Gap
      // En BOOM (BUY): Precio debe estar por encima del Gap y retrocediendo hacia él
      // En CRASH (SELL): Precio debe estar por debajo del Gap y retrocediendo hacia él
      const inRetracement = isBoom ? currentPrice > gapPrice : currentPrice < gapPrice;
      if (!inRetracement) continue;

      // 2. CONDICIÓN: Entrada 2 minutos antes de llegar a la línea del Gap
      // En retroceso continuo sin spike: distance / drift = tiempo estimado en minutos
      const minutesToArrival = drift > 0 ? distance / drift : 0;
      // Ventana de ~2 minutos antes (0.8 a 2.8 minutos antes de tocar la línea del Gap)
      const isTwoMinutesBefore = minutesToArrival >= 0.8 && minutesToArrival <= 2.8;
      if (!isTwoMinutesBefore) continue;

      const nowSec = Math.floor(now / 1000);
      const lastAlertMatch = (level.evaluationReason || '').match(/GAP_SPIKE_ALERTED:(\d+)/);
      const lastAlertedSec = lastAlertMatch ? Number(lastAlertMatch[1]) : 0;

      // 3. ENVÍO A TELEGRAM (con deduplicación de 30m)
      if (nowSec - lastAlertedSec >= 1800) {
        await this.levels.update(level.id, {
          evaluationReason: `GAP_SPIKE_ALERTED:${nowSec} - ${level.evaluationReason || ''}`.slice(0, 250),
        });

        await this.whatsapp.notifyGapSpikeAlert({
          symbol: level.symbol || cleanSymbol,
          direction: targetDirection,
          entryPrice: gapPrice,
          currentPrice,
          distance,
          minutesToArrival,
          trendM15,
          ema50_M15,
          consecutiveRetracementM1,
          note: level.note || undefined,
        });
      }

      // 4. EJECUCIÓN AUTOMÁTICA DEL TRADE 2 MINUTOS ANTES DE LA LÍNEA DEL GAP
      if (!isOnline) continue;

      const lock = await this.levels.update(
        { id: level.id, status: In(['PENDING', 'EVALUATING']) },
        {
          status: 'EXECUTING',
          evaluationReason: `GAP_SPIKE_ALERTED:${nowSec} - Ejecutando entrada 2 min antes del Gap (${minutesToArrival.toFixed(1)} min / ${distance.toFixed(2)} pts).`,
        },
      );
      if (!lock.affected) continue;

      try {
        const trade = await this.trading.executeWatchedLevelTrade({
          symbol: level.symbol || cleanSymbol,
          direction: targetDirection,
          lot: level.lot,
          entryPrice: currentPrice,
          isBacktesting: Boolean(level.backtesting),
          levelId: level.id,
        });

        if (!trade) {
          throw new Error('Trade de Gap bloqueado o MT5 no confirmó apertura.');
        }

        const btLabel = level.backtesting ? ' [BACKTESTING]' : ' [REAL]';
        await this.levels.update(level.id, {
          status: 'EXECUTED',
          executedAt: Math.floor(Date.now() / 1000),
          evaluationReason: `Entrada 2 min antes del Gap ejecutada${btLabel} (${minutesToArrival.toFixed(1)}m antes @ ${currentPrice.toFixed(2)} -> Gap ${gapPrice.toFixed(2)}). Trade: ${trade.id}`,
        });
        await this.whatsapp.notifyWatchedLevel(level.symbol || cleanSymbol, gapPrice, 'EN_PUNTO');
        break; // Máximo 1 ejecución de Gap por ciclo de tick en este símbolo
      } catch (error: any) {
        await this.levels.update(level.id, {
          status: 'EVALUATING',
          evaluationReason: `GAP_SPIKE_ALERTED:${nowSec} - En espera de cupo (${error?.message || 'reintentando'}).`,
        });
      }
    }
  }
}

