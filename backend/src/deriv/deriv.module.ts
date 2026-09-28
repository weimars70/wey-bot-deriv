import { Module } from '@nestjs/common';
import { DerivWebsocketService } from './deriv-websocket.service';
import { DerivController } from './deriv.controller';

@Module({
  providers: [DerivWebsocketService],
  controllers: [DerivController],
  exports: [DerivWebsocketService],
})
export class DerivModule {}
