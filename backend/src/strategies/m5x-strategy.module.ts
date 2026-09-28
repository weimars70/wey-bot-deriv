import { Module } from '@nestjs/common';
import { CandlesModule } from '../candles/candles.module';
import { M5XStrategyController } from './m5x-strategy.controller';
import { M5XStrategyService } from './m5x-strategy.service';

@Module({
  imports: [CandlesModule],
  controllers: [M5XStrategyController],
  providers: [M5XStrategyService],
  exports: [M5XStrategyService],
})
export class M5XStrategyModule {}
