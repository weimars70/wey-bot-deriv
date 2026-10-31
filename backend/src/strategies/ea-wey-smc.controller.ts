import { Controller, Get } from '@nestjs/common';
import { EaWeySMCService, EaWeySMCResult } from './ea-wey-smc.service';

@Controller('ea-wey-smc')
export class EaWeySMCController {
  constructor(private readonly eaWeySMCService: EaWeySMCService) {}

  /** GET /api/ea-wey-smc/scanner — público, sin JWT guard */
  @Get('scanner')
  async scanner(): Promise<EaWeySMCResult[]> {
    return this.eaWeySMCService.scanAll();
  }
}
