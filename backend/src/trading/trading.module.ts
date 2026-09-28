import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradeRecord } from './trade.entity';
import { TradingBotService } from './trading-bot.service';
import { TradingBotController } from './trading-bot.controller';
import { CrashIaStrategyModule } from '../strategies/crash-ia-strategy.module';
import { H1StrategyModule } from '../strategies/h1-strategy.module';
import { M5PlusStrategyModule } from '../strategies/m5plus-strategy.module';
import { M5XStrategyModule } from '../strategies/m5x-strategy.module';
import { TradingStatsService } from './trading-stats.service';
import { BacktestService } from './backtest.service';
import { CandlesModule } from '../candles/candles.module';
import { DerivModule } from '../deriv/deriv.module';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ApexSignalsModule } from '../apex-signals/apex-signals.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TradeRecord]),
    CrashIaStrategyModule,
    H1StrategyModule,
    M5PlusStrategyModule,
    M5XStrategyModule,
    CandlesModule,
    DerivModule,
    UsersModule,
    NotificationsModule,
    ApexSignalsModule,
  ],
  controllers: [TradingBotController],
  providers: [TradingBotService, TradingStatsService, BacktestService],
  exports: [TradingBotService, TradingStatsService, BacktestService],
})
export class TradingModule {}
