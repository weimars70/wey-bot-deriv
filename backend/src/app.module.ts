import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import databaseConfig from './config/database.config';
import { DerivModule } from './deriv/deriv.module';
import { TicksModule } from './ticks/ticks.module';
import { CandlesModule } from './candles/candles.module';
import { AccountModule } from './account/account.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SignalsModule } from './signals/signals.module';
import { ApexSignalsModule } from './apex-signals/apex-signals.module';
import { H1StrategyModule } from './strategies/h1-strategy.module';
import { CrashIaStrategyModule } from './strategies/crash-ia-strategy.module';
import { CrashSpikeStrategyModule } from './strategies/crash-spike-strategy.module';
import { M5PlusStrategyModule } from './strategies/m5plus-strategy.module';
import { M5XStrategyModule } from './strategies/m5x-strategy.module';
import { TradingModule } from './trading/trading.module';
import { WatchedLevelsModule } from './watched-levels/watched-levels.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'production' ? ['.env.production', '.env'] : ['.env'],
      load: [databaseConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService): TypeOrmModuleOptions =>
        configService.getOrThrow<TypeOrmModuleOptions>('database'),
      inject: [ConfigService],
    }),
    EventEmitterModule.forRoot(),
    DerivModule,
    TicksModule,
    CandlesModule,
    AccountModule,
    UsersModule,
    AuthModule,
    RealtimeModule,
    SignalsModule,
    ApexSignalsModule,
    H1StrategyModule,
    CrashIaStrategyModule,
    CrashSpikeStrategyModule,
    M5PlusStrategyModule,
    M5XStrategyModule,
    TradingModule,
    WatchedLevelsModule,
  ],
})
export class AppModule {}
