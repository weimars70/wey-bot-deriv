import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchedEntryLevel } from './watched-level.entity';
import { WatchedLevelsController } from './watched-levels.controller';
import { WatchedLevelsService } from './watched-levels.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { TradingModule } from '../trading/trading.module';

@Module({
  imports: [TypeOrmModule.forFeature([WatchedEntryLevel]), NotificationsModule, TradingModule],
  controllers: [WatchedLevelsController],
  providers: [WatchedLevelsService],
})
export class WatchedLevelsModule {}
