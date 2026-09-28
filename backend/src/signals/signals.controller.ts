import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SignalsService } from './signals.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('signals')
export class SignalsController {
  constructor(private readonly signalsService: SignalsService) {}

  // GET /api/signals?symbol=CRASH300N&granularity=60
  @UseGuards(JwtAuthGuard)
  @Get()
  getSignal(
    @Query('symbol') symbol: string,
    @Query('granularity') granularity?: string,
  ) {
    return this.signalsService.getSignal(symbol, granularity ? parseInt(granularity, 10) : 60);
  }

  // GET /api/signals/all — señal por símbolo (crash + boom con datos en BD)
  @UseGuards(JwtAuthGuard)
  @Get('all')
  getAllSignals() {
    return this.signalsService.getAllSignals();
  }

  // POST /api/signals/subscribe-targets — suscribe batch a todos crash/boom
  @UseGuards(JwtAuthGuard)
  @Post('subscribe-targets')
  subscribeTargets() {
    return this.signalsService.subscribeTargetSymbols();
  }

  // ── Dev-only (sin JWT) ────────────────────────────────────────────────────

  @Get('public')
  getSignalPublic(
    @Query('symbol') symbol: string,
    @Query('granularity') granularity?: string,
  ) {
    if (process.env.NODE_ENV === 'production') return { error: 'Not allowed in production' };
    return this.signalsService.getSignal(symbol, granularity ? parseInt(granularity, 10) : 60);
  }

  @Get('all/public')
  getAllSignalsPublic() {
    if (process.env.NODE_ENV === 'production') return { error: 'Not allowed in production' };
    return this.signalsService.getAllSignals();
  }

  @Post('subscribe-targets/public')
  subscribeTargetsPublic() {
    if (process.env.NODE_ENV === 'production') return { error: 'Not allowed in production' };
    return this.signalsService.subscribeTargetSymbols();
  }

  /** Dev: muestra qué crash/boom hay en la BD y cuáles devuelve Deriv */
  @Get('debug')
  async debug() {
    if (process.env.NODE_ENV === 'production') return { error: 'Not allowed in production' };
    return this.signalsService.debugInfo();
  }
}
