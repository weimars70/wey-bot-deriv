import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { EvolutionCallService } from './evolution-call.service';

@Module({
  imports: [UsersModule],
  providers: [EvolutionCallService],
  exports: [EvolutionCallService],
})
export class NotificationsModule {}
