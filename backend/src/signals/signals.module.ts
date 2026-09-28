import { Module } from '@nestjs/common';
import { CandlesModule } from '../candles/candles.module';
import { DerivModule } from '../deriv/deriv.module';
import { SignalsService } from './signals.service';
import { SignalsController } from './signals.controller';

@Module({
  imports: [CandlesModule, DerivModule],
  providers: [SignalsService],
  controllers: [SignalsController],
  exports: [SignalsService],
})
export class SignalsModule {}
