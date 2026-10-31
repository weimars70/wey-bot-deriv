import { Controller, Get, Query } from '@nestjs/common';
import { EaWeySMCService, EaWeySMCResult, ChartData } from './ea-wey-smc.service';

@Controller('ea-wey-smc')
export class EaWeySMCController {
  constructor(private readonly eaWeySMCService: EaWeySMCService) {}

  /** GET /api/ea-wey-smc/scanner — público, sin JWT guard */
  @Get('scanner')
  async scanner(): Promise<EaWeySMCResult[]> {
    return this.eaWeySMCService.scanAll();
  }

  /** GET /api/ea-wey-smc/chart?symbol=CRASH500 — público, datos de velas y marcadores SMC */
  @Get('chart')
  async chart(@Query('symbol') symbol?: string): Promise<ChartData | { error: string }> {
    const sym = symbol || 'CRASH500';
    const data = await this.eaWeySMCService.getChartData(sym);
    if (!data) return { error: `Símbolo no encontrado: ${sym}` };
    return data;
  }
}
