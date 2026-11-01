import { Controller, Get, Query } from '@nestjs/common';
import { SmcSyntheticsService } from './smc-synthetics.service';

@Controller('smc-synthetics')
export class SmcSyntheticsController {
  constructor(private readonly smcService: SmcSyntheticsService) {}

  /**
   * GET /api/smc-synthetics/scanner
   * Retorna el escaneo en tiempo real de los 16 índices sintéticos (Step, Volatility, Jump)
   */
  @Get('scanner')
  async getScanner() {
    return this.smcService.scanAll();
  }

  /**
   * GET /api/smc-synthetics/chart?symbol=R_100
   * Retorna las velas M5/H1 y las marcas SMC (Zonas, Swings, OB, FVG, SL, TP) para el gráfico interactivo
   */
  @Get('chart')
  async getChart(@Query('symbol') symbol: string) {
    if (!symbol) return null;
    return this.smcService.getChartData(symbol);
  }
}
