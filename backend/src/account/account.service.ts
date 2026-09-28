import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { AccountSnapshot } from './account.entity';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);
  private authorizeInfo: any = null;

  constructor(
    @InjectRepository(AccountSnapshot)
    private readonly accountRepo: Repository<AccountSnapshot>,
  ) {}

  @OnEvent('deriv.authorize')
  handleAuthorize(info: any) {
    if (!info) {
      this.logger.warn('Respuesta de autorización vacía (token inválido o rechazado)');
      return;
    }
    this.authorizeInfo = info;
    this.logger.log(`Cuenta autorizada: ${info.loginid} (${info.email})`);
  }

  @OnEvent('deriv.balance')
  async handleBalance(balance: any) {
    try {
      const snapshot = this.accountRepo.create({
        loginid: balance.loginid,
        balance: balance.balance,
        currency: balance.currency,
        email: this.authorizeInfo?.email ?? null,
        isVirtual: this.authorizeInfo?.is_virtual === 1,
      });
      await this.accountRepo.save(snapshot);
    } catch (e) {
      this.logger.error(`Error guardando snapshot de balance: ${e}`);
    }
  }

  getCurrentInfo() {
    return this.authorizeInfo;
  }

  findLatestSnapshot() {
    return this.accountRepo.find({ order: { createdAt: 'DESC' }, take: 1 });
  }

  findHistory(limit = 100) {
    return this.accountRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
