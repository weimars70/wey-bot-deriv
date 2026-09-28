import { Module } from '@nestjs/common';
import { CandlesModule } from '../candles/candles.module';
import { M5PlusStrategyService } from './m5plus-strategy.service';
import { M5PlusStrategyController } from './m5plus-strategy.controller';

@Module({
  imports: [CandlesModule],
  controllers: [M5PlusStrategyController],
  providers: [M5PlusStrategyService],
  exports: [M5PlusStrategyService],
})
export class M5PlusStrategyModule {}
