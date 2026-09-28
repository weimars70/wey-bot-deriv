import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AccountService } from './account.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('account')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  // GET /api/account/info -> datos de la sesión autorizada (loginid, email, etc.)
  @Get('info')
  getInfo() {
    return this.accountService.getCurrentInfo();
  }

  // GET /api/account/balance -> último snapshot de balance guardado
  @Get('balance')
  async getBalance() {
    const [latest] = await this.accountService.findLatestSnapshot();
    return latest ?? { message: 'Aún no hay datos de balance disponibles' };
  }

  // GET /api/account/history?limit=100
  @Get('history')
  getHistory(@Query('limit') limit?: string) {
    return this.accountService.findHistory(
      limit ? parseInt(limit, 10) : 100,
    );
  }
}
