import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Candle } from './candle.entity';
import { CandlesService } from './candles.service';
import { CandlesController } from './candles.controller';
import { CandlesPublicController } from './candles.public.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Candle])],
  providers: [CandlesService],
  controllers: [CandlesController, CandlesPublicController],
  exports: [CandlesService],
})
export class CandlesModule {}
