import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { M5XStrategyService, M5X_SYMBOLS } from './m5x-strategy.service';

@Controller('strategies/m5x')
export class M5XStrategyController {
  constructor(private readonly service: M5XStrategyService) {}

  @Get('live')
  getLive(@Query('symbol') symbol?: string) {
    return this.service.evaluateLive(symbol || 'CRASH500');
  }

  @Get('live-all')
  getLiveAll() {
    return this.service.evaluateLiveAll();
  }

  @Post('backtest')
  runBacktest(@Body('symbol') symbol?: string, @Body('days') days?: number) {
    return this.service.runBacktestSymbol(symbol || 'CRASH500', Number(days) || 14);
  }

  @Post('backtest-all')
  runBacktestAll(@Body('days') days?: number) {
    return this.service.runBacktestAll(Number(days) || 14);
  }

  @Get('supported-symbols')
  getSupportedSymbols() {
    return { symbols: M5X_SYMBOLS };
  }
}
