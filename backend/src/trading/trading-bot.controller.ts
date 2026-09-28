import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { TradingBotService } from './trading-bot.service';
import { TradingStatsService } from './trading-stats.service';
import { BacktestService, BacktestParams } from './backtest.service';

@Controller('trading')
export class TradingBotController {
  constructor(
    private readonly tradingService: TradingBotService,
    private readonly statsService: TradingStatsService,
    private readonly backtestService: BacktestService,
  ) {}

  @Get('backtest/symbols')
  getBacktestSymbols() {
    return this.backtestService.getAvailableSymbols();
  }

  @Post('backtest/run')
  runBacktest(@Body() params: BacktestParams) {
    return this.backtestService.runBacktest(params);
  }

  @Get('active')
  getActiveTrades() {
    return this.tradingService.getActiveTrades();
  }

  @Get('config')
  getConfig() {
    return this.tradingService.getConfig();
  }

  @Get('history')
  getHistory(@Query('limit') limit?: number) {
    return this.tradingService.getTradeHistory(limit ? Number(limit) : 50);
  }

  @Get('daily-report')
  getDailyReport(
    @Query('date') date?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.statsService.getDailyReport(startDate || date, endDate);
  }

  @Get('adaptive-status')
  getAdaptiveStatus() {
    return this.statsService.getAdaptiveStatus();
  }

  @Post('toggle-adaptive')
  toggleAdaptive(@Body('enabled') enabled?: boolean) {
    return this.statsService.toggleAdaptive(enabled);
  }

  @Get('mt5-status')
  getMt5Status() {
    return this.tradingService.getMt5Status();
  }

  @Get('bridge/commands')
  getBridgeCommands() {
    return this.tradingService.getPendingMt5Commands();
  }

  @Post('bridge/feedback')
  postBridgeFeedback(@Body() body: any) {
    return this.tradingService.handleMt5Feedback(body?.feedback ?? body);
  }

  @Post('bridge/positions')
  postBridgePositions(@Body() body: any) {
    const positions = Array.isArray(body) ? body : (body?.positions ?? []);
    return this.tradingService.handleMt5Positions(positions);
  }

  @Post('bridge/history')
  postBridgeHistory(@Body() body: any) {
    const history = Array.isArray(body) ? body : (body?.history ?? []);
    return this.tradingService.handleMt5History(history);
  }

  @Post('toggle')
  toggleConfig(
    @Body('strategy') strategy: 'h1' | 'crashBoom' | 'm5Plus' | 'm5X',
    @Body('enabled') enabled?: boolean,
  ) {
    return this.tradingService.toggleConfig(strategy, enabled);
  }

  @Post('close/:id')
  closeTrade(@Param('id') id: string) {
    return this.tradingService.closeTrade(id, 'MANUAL_USER_CLOSE');
  }

  @Post('reset-counts')
  resetCounts(@Body('symbol') symbol?: string) {
    return this.tradingService.resetSymbolTradesCount(symbol);
  }

  @Post('clear-ghosts')
  clearGhosts() {
    return this.tradingService.clearAllPhantomTrades();
  }

  @Post('execute')
  executeTrade(
    @Body('symbol') symbol: string,
    @Body('direction') direction: 'BUY' | 'SELL',
    @Body('lot') lot?: number,
    @Body('stopLossPrice') stopLossPrice?: number,
    @Body('takeProfitPrice') takeProfitPrice?: number,
  ) {
    return this.tradingService.executeManualTrade({
      symbol,
      direction,
      lot,
      stopLossPrice,
      takeProfitPrice,
    });
  }
}
