import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tick } from './tick.entity';
import { TicksService } from './ticks.service';
import { TicksController } from './ticks.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Tick])],
  providers: [TicksService],
  controllers: [TicksController],
  exports: [TicksService],
})
export class TicksModule {}
