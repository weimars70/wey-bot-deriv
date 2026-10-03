import { Controller, Get, Query } from '@nestjs/common';
import { SignalCenterService } from './signal-center.service';

@Controller('signal-center')
export class SignalCenterController {
  constructor(private readonly signalCenter: SignalCenterService) {}

  @Get('alerts')
  list(@Query('limit') limit?: string) {
    return this.signalCenter.list(limit ? Number(limit) : 60);
  }
}
