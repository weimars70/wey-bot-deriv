import { Controller, Get, Query } from '@nestjs/common';
import { CrashIaStrategyService } from './crash-ia-strategy.service';

@Controller('strategies/crash-ia')
export class CrashIaStrategyController {
  constructor(private readonly crashIaService: CrashIaStrategyService) {}

  /**
   * GET /api/strategies/crash-ia/evaluate?symbol=CRASH1000&timeframe=5
   * Devuelve niveles de zonas, estado de filtros y serie de velas para el gráfico.
   */
  @Get('evaluate')
  async evaluate(
    @Query('symbol') symbol?: string,
    @Query('timeframe') timeframe?: string,
  ) {
    const sym = symbol || 'CRASH1000';
    const tf = timeframe ? parseInt(timeframe, 10) : 5;
    return this.crashIaService.evaluateSymbol(sym, tf);
  }

  /**
   * GET /api/strategies/crash-ia/summary
   * Devuelve el estado rápido de todos los índices Crash.
   */
  @Get('summary')
  async summary() {
    return this.crashIaService.getSummaryAll();
  }

  @Get('double-wick')
  async doubleWick(@Query('symbol') symbol?: string) {
    const sym = symbol || 'BOOM100';
    return this.crashIaService.evaluateDoubleWickMecha(sym);
  }

  @Get('double-wick-summary')
  async doubleWickSummary() {
    return this.crashIaService.getDoubleWickMechaSummary();
  }

  /** H1 solo alerta: nunca es consumido por el bot de ejecución automática. */
  @Get('double-wick-h1-summary')
  async doubleWickH1Summary() {
    return this.crashIaService.getDoubleWickH1Summary();
  }

  /**
   * GET /api/strategies/crash-ia/double-wick-history?symbol=BOOM500&days=7
   * Escanea las últimas N velas M5 históricas, detecta cada ocurrencia del patrón
   * de dos velas y verifica si en las siguientes 6 velas apareció un spike.
   */
  @Get('double-wick-history')
  async doubleWickHistory(
    @Query('symbol') symbol?: string,
    @Query('days') days?: string,
  ) {
    const sym = symbol || 'BOOM500';
    const d = days ? parseInt(days, 10) : 7;
    return this.crashIaService.getDoubleWickHistory(sym, d);
  }
}
