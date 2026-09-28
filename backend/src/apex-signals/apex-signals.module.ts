import { Module } from '@nestjs/common';
import { ApexSignalsService } from './apex-signals.service';
import { ApexSignalsController } from './apex-signals.controller';
import { ApexLocalEngineService } from './apex-local-engine.service';
import { WeySignalsService } from './wey-signals.service';
import { WeySignalsController } from './wey-signals.controller';
import { SignalsModule } from '../signals/signals.module';

@Module({
  imports: [SignalsModule],
  providers: [ApexSignalsService, ApexLocalEngineService, WeySignalsService],
  controllers: [ApexSignalsController, WeySignalsController],
  exports: [ApexSignalsService, ApexLocalEngineService, WeySignalsService],
})
export class ApexSignalsModule {}
