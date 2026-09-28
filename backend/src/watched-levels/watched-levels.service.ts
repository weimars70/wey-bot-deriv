import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { WatchedEntryLevel } from './watched-level.entity';
import { EvolutionCallService } from '../notifications/evolution-call.service';
import { TradingBotService } from '../trading/trading-bot.service';
import { TradeRecord } from '../trading/trade.entity';

@Injectable()
export class WatchedLevelsService implements OnModuleInit {
  private readonly rearmedTradeIds = new Set<string>();

  constructor(
    @InjectRepository(WatchedEntryLevel)
    private readonly levels: Repository<WatchedEntryLevel>,
    private readonly whatsapp: EvolutionCallService,
    private readonly trading: TradingBotService,
  ) {}

  async onModuleInit() {
    // Liberar cualquier punto que haya quedado en 'EXECUTING' por reinicio previo o desconexión
    await this.levels.update(
      { status: 'EXECUTING' },
      { status: 'PENDING', evaluationReason: 'Restablecido al inicio. Esperando toque en retroceso.' },
    );
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

    // Solo evaluar o ejecutar si weimarsuber@gmail.com está activo en la app
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

    for (const level of levels) {
      const distance = Math.abs(price - level.entryPrice);
      const inPoint = distance <= 0.5;
      const approaching = distance <= 2.0;

      // ── CASO A: Recuperar puntos atascados en EXECUTING si pasaron > 30s sin respuesta ──
      if (level.status === 'EXECUTING') {
        const timeSinceUpdate = (Date.now() - new Date(level.updatedAt).getTime()) / 1000;
        if (timeSinceUpdate > 30) {
          await this.levels.update(level.id, {
            status: 'PENDING',
            evaluationReason: 'Punto liberado de ejecución tras tiempo de espera. Listo para evaluar en retroceso.',
          });
        }
        continue;
      }

      // ── CASO B: RE-ARMADO AUTOMÁTICO DE PUNTOS EJECUTADOS EN RETROCESO ──
      // Todo punto debe volver a evaluarse el mismo día u otros días cuando el precio se aleja y vuelve en retroceso
      if (level.status === 'EXECUTED') {
        const nowSec = Math.floor(Date.now() / 1000);
        const timeSinceExec = nowSec - (level.executedAt || 0);
        if (distance > 3.0 && timeSinceExec >= 45) {
          await this.levels.update(level.id, {
            status: 'PENDING',
            evaluationReason: 'Punto rearmado: el precio se alejó de la zona. Listo para ejecutar al llegar en retroceso.',
          });
        }
        continue;
      }

      // ── CASO C: PUNTOS PENDING O EVALUATING ──
      if (!approaching) {
        if (level.status === 'EVALUATING') {
          await this.levels.update(level.id, {
            status: 'PENDING',
            evaluationReason: 'Esperando que el precio vuelva a la zona del punto registrado.',
          });
        }
        continue;
      }

      if (!inPoint) {
        if (level.status === 'PENDING') {
          level.status = 'EVALUATING';
          level.evaluationReason = 'Llegando al punto registrado: esperando toque exacto para ejecutar.';
          await this.levels.save(level);
          await this.whatsapp.notifyWatchedLevel(level.symbol, level.entryPrice, 'LLEGANDO');
        }
        continue;
      }

      // Toque en punto (distance <= 0.5)
      const lock = await this.levels.update(
        { id: level.id, status: In(['PENDING', 'EVALUATING']) },
        { status: 'EXECUTING', evaluationReason: 'Punto tocado: enviando orden a MT5.' },
      );
      if (!lock.affected) continue;

      try {
        const trade = await this.trading.executeWatchedLevelTrade({
          symbol: level.symbol || rawSymbol,
          direction: level.direction,
          lot: level.lot,
          entryPrice: level.entryPrice,
          isBacktesting: Boolean(level.backtesting),
          levelId: level.id,
        });
        if (!trade) throw new Error('MT5 no confirmó la creación de la orden o trade bloqueado.');
        const btLabel = level.backtesting ? ' [BACKTESTING]' : ' [REAL]';
        await this.levels.update(level.id, {
          status: 'EXECUTED',
          executedAt: Math.floor(Date.now() / 1000),
          evaluationReason: `Orden enviada a MT5${btLabel}. Trade: ${trade.id} (${trade.strategy})`,
        });
        await this.whatsapp.notifyWatchedLevel(level.symbol, level.entryPrice, 'EN_PUNTO');
      } catch (error: any) {
        await this.levels.update(level.id, {
          status: 'PENDING',
          evaluationReason: `No se pudo abrir la orden: ${error?.message || 'error desconocido'}. Reintentando en próximo retroceso.`,
        });
      }
    }
  }

  private suggestedLot(symbol: string): number {
    const value = (symbol || '').toUpperCase().replace(/\s+/g, '');
    return value.includes('CRASH600') || value.includes('CRASH900') || value.includes('BOOM1000')
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
}
