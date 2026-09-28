import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { WeySignalsService } from './wey-signals.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('wey-signals')
export class WeySignalsController {
  constructor(private readonly weySvc: WeySignalsService) {}

  /**
   * GET /api/wey-signals
   * Retorna las señales locales calculadas por el motor Wey,
   * ordenadas estrictamente por orden de estrellas de mayor a menor (4★ → 3★).
   * Opcional: ?minStars=3&onlyViable=true
   */
  @UseGuards(JwtAuthGuard)
  @Get()
  getSignals(
    @Query('minStars') minStars?: string,
    @Query('onlyViable') onlyViable?: string,
  ) {
    const min = minStars ? parseInt(minStars, 10) : 0;
    const viable = onlyViable !== 'false';
    return this.weySvc.getSignals(min, viable);
  }

  /**
   * GET /api/wey-signals/compare
   * Compara en vivo las señales locales Wey frente a las de Apex.
   */
  @UseGuards(JwtAuthGuard)
  @Get('compare')
  getComparison(@Query('force') force?: string) {
    return this.weySvc.compare(force === 'true');
  }

  // ── Rutas públicas para desarrollo ──────────────────────────────────────────

  /** GET /api/wey-signals/public — sin JWT (dev) */
  @Get('public')
  getSignalsPublic(
    @Query('minStars') minStars?: string,
    @Query('onlyViable') onlyViable?: string,
  ) {
    const min = minStars ? parseInt(minStars, 10) : 0;
    const viable = onlyViable !== 'false';
    return this.weySvc.getSignals(min, viable);
  }

  /** GET /api/wey-signals/compare/public — sin JWT (dev) */
  @Get('compare/public')
  getComparisonPublic(@Query('force') force?: string) {
    return this.weySvc.compare(force === 'true');
  }
}
