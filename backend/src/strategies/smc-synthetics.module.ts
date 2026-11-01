import { Module } from '@nestjs/common';
import { CandlesModule } from '../candles/candles.module';
import { DerivModule } from '../deriv/deriv.module';
import { SmcSyntheticsController } from './smc-synthetics.controller';
import { SmcSyntheticsService } from './smc-synthetics.service';

@Module({
  imports: [CandlesModule, DerivModule],
  controllers: [SmcSyntheticsController],
  providers: [SmcSyntheticsService],
  exports: [SmcSyntheticsService],
})
export class SmcSyntheticsModule {}
