import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { WatchedLevelsService } from './watched-levels.service';

@Controller('watched-levels')
export class WatchedLevelsController {
  constructor(private readonly service: WatchedLevelsService) {}
  @Get() list(
    @Query('symbol') symbol?: string,
    @Query('price') price?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
  ) {
    return this.service.list({
      symbol,
      price: price === undefined ? undefined : Number(price),
      minPrice: minPrice === undefined ? undefined : Number(minPrice),
      maxPrice: maxPrice === undefined ? undefined : Number(maxPrice),
    });
  }
  @Post() create(@Body() body: any) { return this.service.create(body); }
  @Post(':id/cancel') cancel(@Param('id') id: string) { return this.service.cancel(id); }
  @Post(':id/multiple-reactions') setMultipleReactions(
    @Param('id') id: string,
    @Body('multipleReactions') multipleReactions: boolean,
  ) { return this.service.setMultipleReactions(id, multipleReactions); }
}
