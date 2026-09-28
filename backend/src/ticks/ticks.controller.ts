import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { TicksService } from './ticks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('ticks')
export class TicksController {
  constructor(private readonly ticksService: TicksService) {}

  // GET /api/ticks?symbol=R_100&limit=100
  @Get()
  findLatest(
    @Query('symbol') symbol?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ticksService.findLatest(
      symbol,
      limit ? parseInt(limit, 10) : 100,
    );
  }
}
