import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module'; // exporta JwtModule, lo reutilizamos aquí
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
