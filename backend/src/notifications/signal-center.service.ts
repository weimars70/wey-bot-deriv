import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Not, Repository } from 'typeorm';
import { SignalCenterAlert } from './signal-center-alert.entity';

export interface PublishSignalCenterAlert {
  type: string;
  symbol?: string | null;
  title: string;
  message: string;
  speechText?: string | null;
  targetPath?: string;
  routeQuery?: Record<string, unknown> | null;
  severity?: string;
  dedupeKey: string;
}

@Injectable()
export class SignalCenterService {
  private readonly logger = new Logger(SignalCenterService.name);
  private lastCleanupAt = 0;

  constructor(
    @InjectRepository(SignalCenterAlert)
    private readonly alertsRepo: Repository<SignalCenterAlert>,
    private readonly events: EventEmitter2,
  ) {}

  async publish(input: PublishSignalCenterAlert): Promise<SignalCenterAlert> {
    if (input.type === 'CRASH_REVIEW' || input.type === 'BOOM_REVIEW') {
      throw new Error(`Se descarto una alerta no operable: ${input.type}`);
    }

    const existing = await this.alertsRepo.findOne({
      where: { dedupeKey: input.dedupeKey },
    });
    if (existing) return existing;

    const alert = this.alertsRepo.create({
      type: input.type,
      symbol: input.symbol || null,
      title: input.title,
      message: input.message,
      speechText: input.speechText || null,
      targetPath: input.targetPath || '/dashboard',
      routeQuery: input.routeQuery || null,
      severity: input.severity || 'warning',
      dedupeKey: input.dedupeKey,
    });

    try {
      const saved = await this.alertsRepo.save(alert);
      this.events.emit('signal-center.alert', saved);
      void this.cleanupOldAlerts();
      return saved;
    } catch (error: any) {
      if (error?.code === '23505') {
        const duplicate = await this.alertsRepo.findOne({
          where: { dedupeKey: input.dedupeKey },
        });
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }

  list(limit = 60): Promise<SignalCenterAlert[]> {
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 60));
    return this.alertsRepo.find({
      where: { type: Not(In(['CRASH_REVIEW', 'BOOM_REVIEW'])) },
      order: { createdAt: 'DESC' },
      take: safeLimit,
    });
  }

  private async cleanupOldAlerts(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanupAt < 6 * 60 * 60 * 1000) return;
    this.lastCleanupAt = now;
    const cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000);
    try {
      await this.alertsRepo.delete({ createdAt: LessThan(cutoff) });
    } catch (error: any) {
      this.logger.warn(`No se pudo limpiar el centro de alertas: ${error?.message || error}`);
    }
  }
}
