import { Module, forwardRef } from '@nestjs/common';
import { CandlesModule } from '../candles/candles.module';
import { DerivModule } from '../deriv/deriv.module';
import { TradingModule } from '../trading/trading.module';
import { CrashSpikeStrategyService } from './crash-spike-strategy.service';
import { CrashSpikeStrategyController } from './crash-spike-strategy.controller';

@Module({
  imports: [
    CandlesModule,
    DerivModule,
    forwardRef(() => TradingModule),
  ],
  controllers: [CrashSpikeStrategyController],
  providers: [CrashSpikeStrategyService],
  exports: [CrashSpikeStrategyService],
})
export class CrashSpikeStrategyModule {}
