import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApexSignalsService } from './apex-signals.service';
import { ApexLocalEngineService } from './apex-local-engine.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('apex-signals')
export class ApexSignalsController {
  constructor(
    private readonly svc: ApexSignalsService,
    private readonly localEngine: ApexLocalEngineService,
  ) {}

  /** GET /api/apex-signals — señales cacheadas (requiere JWT) */
  @UseGuards(JwtAuthGuard)
  @Get()
  getSignals() {
    return this.svc.getSignals();
  }

  /** GET /api/apex-signals/compare — comparar señales locales vs Apex (requiere JWT) */
  @UseGuards(JwtAuthGuard)
  @Get('compare')
  getComparison() {
    return this.localEngine.compare();
  }

  /** POST /api/apex-signals/refresh — forzar actualización (requiere JWT) */
  @UseGuards(JwtAuthGuard)
  @Post('refresh')
  async refresh() {
    return this.svc.forceRefresh();
  }

  /** POST /api/apex-signals/login — iniciar sesión / forzar relevo (requiere JWT) */
  @UseGuards(JwtAuthGuard)
  @Post('login')
  async login(@Body() body: { relevo?: boolean; cuenta?: string }) {
    return this.svc.manualLogin(body?.relevo ?? false, body?.cuenta);
  }

  /** POST /api/apex-signals/session — fijar token manualmente (requiere JWT) */
  @UseGuards(JwtAuthGuard)
  @Post('session')
  async setSession(@Body() body: { token: string }) {
    return this.svc.setSession(body?.token);
  }

  // ── Rutas públicas para desarrollo / pruebas ─────────────────────────────

  /** GET /api/apex-signals/public — sin JWT (solo dev) */
  @Get('public')
  getSignalsPublic() {
    if (process.env.NODE_ENV === 'production') return { error: 'Not allowed in production' };
    return this.svc.getSignals();
  }

  /** GET /api/apex-signals/compare/public — sin JWT (solo dev) */
  @Get('compare/public')
  getComparisonPublic() {
    if (process.env.NODE_ENV === 'production') return { error: 'Not allowed in production' };
    return this.localEngine.compare();
  }

  /** POST /api/apex-signals/refresh/public — forzar refresh sin JWT (solo dev) */
  @Post('refresh/public')
  async refreshPublic() {
    if (process.env.NODE_ENV === 'production') return { error: 'Not allowed in production' };
    return this.svc.forceRefresh();
  }

  /** POST /api/apex-signals/login/public — login/relevo sin JWT (solo dev) */
  @Post('login/public')
  async loginPublic(@Body() body: { relevo?: boolean; cuenta?: string }) {
    if (process.env.NODE_ENV === 'production') return { error: 'Not allowed in production' };
    return this.svc.manualLogin(body?.relevo ?? false, body?.cuenta);
  }

  /** POST /api/apex-signals/session/public — set session sin JWT (solo dev) */
  @Post('session/public')
  async setSessionPublic(@Body() body: { token: string }) {
    if (process.env.NODE_ENV === 'production') return { error: 'Not allowed in production' };
    return this.svc.setSession(body?.token);
  }
}
