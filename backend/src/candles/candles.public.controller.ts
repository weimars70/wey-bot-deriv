import { Controller, Get, Query } from '@nestjs/common';
import { CandlesService } from './candles.service';

@Controller('public/candles')
export class CandlesPublicController {
  constructor(private readonly candlesService: CandlesService) {}

  // Dev-only public endpoint: GET /api/public/candles
  @Get()
  findLatestPublic(
    @Query('symbol') symbol: string,
    @Query('granularity') granularity?: string,
    @Query('limit') limit?: string,
    @Query('order') order?: string,
  ) {
    if (process.env.NODE_ENV === 'production') {
      return { error: 'Not available in production' };
    }
    return this.candlesService
      .findLatest(
        symbol,
        granularity ? parseInt(granularity, 10) : 60,
        limit ? parseInt(limit, 10) : 200,
      )
      .then((rows) => {
        const mapped = rows.map((r) => ({
          ...r,
          epoch: Number((r as any).epoch),
        }));
        if (order === 'asc') return mapped.reverse(); // DB returns DESC
        return mapped;
      });
  }
}
