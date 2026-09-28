import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { Tick } from './tick.entity';

@Injectable()
export class TicksService {
  private readonly logger = new Logger(TicksService.name);
  // Buffer en memoria de los últimos 500 ticks por símbolo para respuestas instantáneas
  private readonly memoryTicks = new Map<string, any[]>();

  constructor(
    @InjectRepository(Tick) private readonly ticksRepo: Repository<Tick>,
  ) {}

  @OnEvent('deriv.tick')
  handleTick(tick: any) {
    if (!tick?.symbol) return;
    const item = {
      symbol: tick.symbol,
      quote: tick.quote,
      epoch: tick.epoch,
      pipSize: tick.pip_size,
      createdAt: new Date(),
    };

    let list = this.memoryTicks.get(tick.symbol);
    if (!list) {
      list = [];
      this.memoryTicks.set(tick.symbol, list);
    }
    list.unshift(item);
    if (list.length > 500) {
      list.pop();
    }
  }

  findLatest(symbol?: string, limit = 100) {
    if (symbol) {
      const list = this.memoryTicks.get(symbol) || [];
      return list.slice(0, limit);
    }
    const all = Array.from(this.memoryTicks.values()).flat();
    all.sort((a, b) => (b.epoch || 0) - (a.epoch || 0));
    return all.slice(0, limit);
  }
}
