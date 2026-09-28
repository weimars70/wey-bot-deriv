import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CandlesService } from './candles.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('candles')
export class CandlesController {
  constructor(private readonly candlesService: CandlesService) {}

  // GET /api/candles?symbol=R_100&granularity=60&limit=200
  @UseGuards(JwtAuthGuard)
  @Get()
  findLatest(
    @Query('symbol') symbol: string,
    @Query('granularity') granularity?: string,
    @Query('limit') limit?: string,
  ) {
    return this.candlesService.findLatest(
      symbol,
      granularity ? parseInt(granularity, 10) : 60,
      limit ? parseInt(limit, 10) : 200,
    );
  }

  // Dev-only: endpoint público para consultar velas sin JWT.
  // Solo habilitado cuando NODE_ENV !== 'production'.
  // GET /api/candles/public?symbol=CRASH1000&granularity=60&limit=200
  @Get('public')
  findLatestPublic(
    @Query('symbol') symbol: string,
    @Query('granularity') granularity?: string,
    @Query('limit') limit?: string,
  ) {
    if (process.env.NODE_ENV === 'production') {
      return { error: 'Not available in production' };
    }
    return this.candlesService.findLatest(
      symbol,
      granularity ? parseInt(granularity, 10) : 60,
      limit ? parseInt(limit, 10) : 200,
    );
  }
}
