import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CandlesModule } from '../candles/candles.module';
import { CrashIaStrategyService } from './crash-ia-strategy.service';
import { CrashIaStrategyController } from './crash-ia-strategy.controller';
import { WatchedEntryLevel } from '../watched-levels/watched-level.entity';

@Module({
  imports: [
    CandlesModule,
    TypeOrmModule.forFeature([WatchedEntryLevel]),
  ],
  controllers: [CrashIaStrategyController],
  providers: [CrashIaStrategyService],
  exports: [CrashIaStrategyService],
})
export class CrashIaStrategyModule {}

