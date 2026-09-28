import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { CrashSpikeStrategyService } from './crash-spike-strategy.service';

@Controller('strategies/crash-spike')
export class CrashSpikeStrategyController {
  constructor(private readonly service: CrashSpikeStrategyService) {}

  @Get('live')
  async getLiveEvaluation(
    @Query('granularity') granularity?: string,
    @Query('symbol') symbol?: string,
  ) {
    const tf = granularity ? parseInt(granularity, 10) : 300;
    return this.service.evaluateLiveCrash600(tf, symbol || 'CRASH600');
  }

  @Post('execute')
  async executeTrade(
    @Body('lot') lot?: number,
    @Body('symbol') symbol?: string,
  ) {
    return this.service.executeCrash600Trade(lot, symbol || 'CRASH600');
  }

  @Post('backtest')
  async runBacktest(
    @Body('days') days?: number,
    @Body('minScore') minScore?: number,
    @Body('symbol') symbol?: string,
  ) {
    const d = days ? Number(days) : 30;
    const s = minScore ? Number(minScore) : 65;
    return this.service.runBacktest(d, s, symbol || 'CRASH600');
  }

  @Get('auto-trading')
  getAutoTradingStatus() {
    return { active: this.service.isAutoTrading() };
  }

  @Post('auto-trading')
  setAutoTradingStatus(@Body('active') active: boolean) {
    const updated = this.service.setAutoTrading(Boolean(active));
    return { ok: true, active: updated };
  }

  @Get('supported-symbols')
  getSupportedSymbols() {
    return { symbols: CrashSpikeStrategyService.SUPPORTED_SYMBOLS };
  }
}
