import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { H1StrategyService } from './h1-strategy.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('strategies/h1-no-wick')
export class H1StrategyController {
  constructor(private readonly h1Svc: H1StrategyService) {}

  /**
   * GET /api/strategies/h1-no-wick
   * Retorna el análisis de las últimas 24 horas de velas H1 por índice
   * y las alertas activas del cambio de hora más reciente.
   */
  @UseGuards(JwtAuthGuard)
  @Get()
  getAnalysis(@Query('tolerance') tolerance?: string) {
    const tol = tolerance ? parseFloat(tolerance) : 0.2;
    return this.h1Svc.analyzeAllIndices(tol);
  }

  /**
   * GET /api/strategies/h1-no-wick/public
   * Versión pública sin autenticación (desarrollo / monitores).
   */
  @Get('public')
  getAnalysisPublic(@Query('tolerance') tolerance?: string) {
    const tol = tolerance ? parseFloat(tolerance) : 0.2;
    return this.h1Svc.analyzeAllIndices(tol);
  }

  /**
   * GET /api/strategies/h1-no-wick/statistics
   * Estadísticas históricas de velas sin mecha por índice, mes y semana con efectividad en la siguiente vela.
   */
  @UseGuards(JwtAuthGuard)
  @Get('statistics')
  getStatistics(
    @Query('month') month?: string,
    @Query('week') week?: string,
    @Query('symbol') symbol?: string,
    @Query('tolerance') tolerance?: string,
  ) {
    const tol = tolerance ? parseFloat(tolerance) : 0.2;
    return this.h1Svc.getH1Statistics({
      month,
      week,
      symbol,
      tolerancePct: tol,
    });
  }

  /**
   * GET /api/strategies/h1-no-wick/statistics/public
   * Estadísticas históricas públicas sin autenticación.
   */
  @Get('statistics/public')
  getStatisticsPublic(
    @Query('month') month?: string,
    @Query('week') week?: string,
    @Query('symbol') symbol?: string,
    @Query('tolerance') tolerance?: string,
  ) {
    const tol = tolerance ? parseFloat(tolerance) : 0.2;
    return this.h1Svc.getH1Statistics({
      month,
      week,
      symbol,
      tolerancePct: tol,
    });
  }

  /**
   * GET /api/strategies/h1-no-wick/real-summary
   * Resumen real por índice evaluando la vela H1 y su primera y segunda vela posterior.
   */
  @UseGuards(JwtAuthGuard)
  @Get('real-summary')
  getRealSummary(
    @Query('month') month?: string,
    @Query('week') week?: string,
    @Query('symbol') symbol?: string,
    @Query('tolerance') tolerance?: string,
    @Query('months') months?: string,
  ) {
    const tol = tolerance ? parseFloat(tolerance) : 0.2;
    const monthsBack = months ? Math.max(1, Math.min(12, Number(months) || 1)) : undefined;
    return this.h1Svc.getRealIndexSummary({
      month,
      week,
      symbol,
      tolerancePct: tol,
      monthsBack,
    });
  }

  @Get('real-summary/public')
  getRealSummaryPublic(
    @Query('month') month?: string,
    @Query('week') week?: string,
    @Query('symbol') symbol?: string,
    @Query('tolerance') tolerance?: string,
    @Query('months') months?: string,
  ) {
    const tol = tolerance ? parseFloat(tolerance) : 0.2;
    const monthsBack = months ? Math.max(1, Math.min(12, Number(months) || 1)) : undefined;
    return this.h1Svc.getRealIndexSummary({
      month,
      week,
      symbol,
      tolerancePct: tol,
      monthsBack,
    });
  }
}
