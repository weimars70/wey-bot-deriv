import { Module } from '@nestjs/common';
import { CandlesModule } from '../candles/candles.module';
import { CrashIaStrategyService } from './crash-ia-strategy.service';
import { CrashIaStrategyController } from './crash-ia-strategy.controller';

@Module({
  imports: [CandlesModule],
  controllers: [CrashIaStrategyController],
  providers: [CrashIaStrategyService],
  exports: [CrashIaStrategyService],
})
export class CrashIaStrategyModule {}
