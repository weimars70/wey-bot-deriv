import { Module } from '@nestjs/common';
import { CandlesModule } from '../candles/candles.module';
import { H1StrategyService } from './h1-strategy.service';
import { H1StrategyController } from './h1-strategy.controller';

@Module({
  imports: [CandlesModule],
  controllers: [H1StrategyController],
  providers: [H1StrategyService],
  exports: [H1StrategyService],
})
export class H1StrategyModule {}
