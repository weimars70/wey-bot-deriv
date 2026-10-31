import { Module } from '@nestjs/common';
import { CandlesModule } from '../candles/candles.module';
import { EaWeySMCService } from './ea-wey-smc.service';
import { EaWeySMCController } from './ea-wey-smc.controller';

@Module({
  imports: [CandlesModule],
  controllers: [EaWeySMCController],
  providers: [EaWeySMCService],
  exports: [EaWeySMCService],
})
export class EaWeySMCModule {}
