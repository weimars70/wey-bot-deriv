import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { EvolutionCallService } from './evolution-call.service';
import { SignalCenterAlert } from './signal-center-alert.entity';
import { SignalCenterController } from './signal-center.controller';
import { SignalCenterService } from './signal-center.service';

@Module({
  imports: [TypeOrmModule.forFeature([SignalCenterAlert]), UsersModule],
  controllers: [SignalCenterController],
  providers: [EvolutionCallService, SignalCenterService],
  exports: [EvolutionCallService, SignalCenterService],
})
export class NotificationsModule {}
