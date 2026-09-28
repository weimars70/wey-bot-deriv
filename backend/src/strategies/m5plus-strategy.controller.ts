import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { M5PlusStrategyService, M5PLUS_SYMBOLS } from './m5plus-strategy.service';

@Controller('strategies/m5plus')
export class M5PlusStrategyController {
  constructor(private readonly service: M5PlusStrategyService) {}

  /**
   * GET /api/strategies/m5plus/live?symbol=CRASH600
   * Evaluación en tiempo real del patrón M5+ para un símbolo.
   */
  @Get('live')
  async getLive(@Query('symbol') symbol?: string) {
    return this.service.evaluateLive(symbol || 'CRASH600');
  }

  /**
   * GET /api/strategies/m5plus/live-all
   * Evaluación en tiempo real de todos los símbolos soportados.
   */
  @Get('live-all')
  async getLiveAll() {
    return this.service.evaluateLiveAll();
  }

  /**
   * POST /api/strategies/m5plus/backtest
   * Body: { symbol?: string, days?: number }
   * Backtest de un símbolo: devuelve cada ocurrencia del patrón y si vino spike.
   */
  @Post('backtest')
  async runBacktest(
    @Body('symbol') symbol?: string,
    @Body('days') days?: number,
  ) {
    const d = days ? Number(days) : 14;
    return this.service.runBacktestSymbol(symbol || 'CRASH600', d);
  }

  /**
   * POST /api/strategies/m5plus/backtest-all
   * Body: { days?: number }
   * Backtest de todos los índices en paralelo — devuelve resumen ejecutivo.
   */
  @Post('backtest-all')
  async runBacktestAll(@Body('days') days?: number) {
    const d = days ? Number(days) : 14;
    return this.service.runBacktestAll(d);
  }

  /**
   * GET /api/strategies/m5plus/supported-symbols
   */
  @Get('supported-symbols')
  getSupportedSymbols() {
    return { symbols: M5PLUS_SYMBOLS };
  }
}
