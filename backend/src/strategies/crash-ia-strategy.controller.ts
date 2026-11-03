import { Controller, Get, Query } from '@nestjs/common';
import { CrashIaStrategyService } from './crash-ia-strategy.service';

@Controller('strategies/crash-ia')
export class CrashIaStrategyController {
  constructor(private readonly crashIaService: CrashIaStrategyService) {}

  /**
   * GET /api/strategies/crash-ia/evaluate?symbol=CRASH1000&timeframe=5
   * Devuelve niveles de zonas, estado de filtros y serie de velas para el grÃ¡fico.
   */
  @Get('evaluate')
  async evaluate(
    @Query('symbol') symbol?: string,
    @Query('timeframe') timeframe?: string,
  ) {
    try {
      const sym = symbol || 'CRASH1000';
      const tf = timeframe ? parseInt(timeframe, 10) : 5;
      return await this.crashIaService.evaluateSymbol(sym, tf);
    } catch (err: any) {
      console.error(`❌ [CRASH-IA] Error en evaluate(${symbol}):`, err);
      throw err;
    }
  }

  /**
   * GET /api/strategies/crash-ia/summary
   * Devuelve el estado rápido de todos los índices Crash.
   */
  @Get('summary')
  async summary() {
    try {
      return await this.crashIaService.getSummaryAll();
    } catch (err: any) {
      console.error('❌ [CRASH-IA] Error en summary():', err);
      throw err;
    }
  }

  /**
   * GET /api/strategies/crash-ia/spike-radar
   * Retorna ÃšNICAMENTE los Ã­ndices con condiciones institucionales completas para spike inminente.
   * Filtro ultra-estricto: canSell|canBuy + OB fresco en zona + V-patrÃ³n + M5 viable + velaAmiga + greenOk + trendOk + precio â‰¤1.5x altura M5 del OB + RSI no sobreextendido.
   */
  @Get('spike-radar')
  async spikeRadar() {
    return this.crashIaService.getSpikeRadar();
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

  /** H1 solo alerta: nunca es consumido por el bot de ejecuciÃ³n automÃ¡tica. */
  @Get('double-wick-h1-summary')
  async doubleWickH1Summary() {
    return this.crashIaService.getDoubleWickH1Summary();
  }

  /**
   * GET /api/strategies/crash-ia/double-wick-history?symbol=BOOM500&days=7
   * Escanea las Ãºltimas N velas M5 histÃ³ricas, detecta cada ocurrencia del patrÃ³n
   * de dos velas y verifica si en las siguientes 6 velas apareciÃ³ un spike.
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
