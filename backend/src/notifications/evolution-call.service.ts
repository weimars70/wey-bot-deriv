import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';

export interface H1AnticipatedCallAlert {
  symbol: string;
  mercado: string;
  closedAt: string;
  direction?: string;
  isAnticipated?: boolean;
  h4Trend?: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL';
  h4AgainstTrade?: boolean;
  historicalReaction?: {
    found: boolean;
    count: number;
    level: number;
    lastReactionAt: string | null;
    lastDirection: 'ALCISTA' | 'BAJISTA' | null;
    lastMovePoints: number;
  };
}

@Injectable()
export class EvolutionCallService {
  private readonly logger = new Logger(EvolutionCallService.name);
  private readonly notifiedWindows = new Map<string, number>();
  private readonly attemptedWindows = new Map<string, number>();

  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async notifyH1Alerts(
    alerts: H1AnticipatedCallAlert[],
    deliveryWindow = 'signal',
  ): Promise<void> {
    const validAlerts = alerts.filter((alert) => alert?.symbol && alert?.closedAt);
    const textEnabled = this.isTextEnabled();
    const callEnabled = this.isCallEnabled();
    if (!validAlerts.length || (!textEnabled && !callEnabled)) return;

    const url = (
      this.config.get<string>('EVOLUTION_API_URL') || 'http://2.58.80.90:3024'
    ).replace(/\/+$/, '');
    const instance = (
      this.config.get<string>('EVOLUTION_INSTANCE') || 'wey-trading-bot'
    ).trim();
    const apiKey = (
      this.config.get<string>('EVOLUTION_API_KEY') ||
      this.config.get<string>('APIKEYWHATSAPP') ||
      ''
    ).trim();
    const recipients = await this.getH1Recipients();
    if (!url || !instance || !apiKey || !recipients.length) {
      this.logger.warn('Alertas H1 por WhatsApp habilitadas, pero faltan datos de Evolution API o destinatarios.');
      return;
    }

    const targetHour = validAlerts
      .map((alert) => alert.closedAt)
      .filter(Boolean)
      .sort()[0] || new Date().toISOString().slice(0, 13);
    this.cleanupOldWindows();

    const notifications: Promise<void>[] = [];
    if (textEnabled) {
      notifications.push(this.sendChannelNotification(
        `H1:text:${targetHour}:${deliveryWindow}:${validAlerts.map((alert) => alert.symbol).sort().join(',')}`,
        recipients,
        `${url}/message/sendText/${encodeURIComponent(instance)}`,
        apiKey,
        (number) => ({ number, text: this.buildH1TextMessage(validAlerts, targetHour) }),
        `Mensaje H1 ${validAlerts.map((alert) => alert.symbol).sort().join(', ')}`,
      ));
    }

    if (callEnabled) {
      const duration = Math.min(
        30,
        Math.max(3, Number(this.config.get<string>('EVOLUTION_H1_CALL_DURATION_SECONDS')) || 12),
      );
      notifications.push(this.sendChannelNotification(
        `H1:call:${targetHour}:${deliveryWindow}:${validAlerts.map((alert) => alert.symbol).sort().join(',')}`,
        recipients.filter((recipient) => !recipient.endsWith('@g.us')),
        `${url}/call/offer/${encodeURIComponent(instance)}`,
        apiKey,
        (number) => ({ number, isVideo: false, callDuration: duration }),
        'Llamada H1',
      ));
    }

    await Promise.all(notifications);
  }

  async notifyWatchedLevel(symbol: string, entryPrice: number, state: 'LLEGANDO' | 'EN_PUNTO'): Promise<void> {
    if (!this.isTextEnabled()) return;
    const url = (this.config.get<string>('EVOLUTION_API_URL') || 'http://2.58.80.90:3024').replace(/\/+$/, '');
    const instance = (this.config.get<string>('EVOLUTION_INSTANCE') || 'wey-trading-bot').trim();
    const apiKey = (this.config.get<string>('EVOLUTION_API_KEY') || this.config.get<string>('APIKEYWHATSAPP') || '').trim();
    const recipients = await this.getAllRecipients();
    if (!apiKey || !recipients.length) return;
    const stateText = state === 'EN_PUNTO' ? 'EN PUNTO REGISTRADO' : 'LLEGANDO A PUNTO REGISTRADO';
    await this.sendChannelNotification(
      `LEVEL:${symbol}:${entryPrice}:${state}`,
      recipients,
      `${url}/message/sendText/${encodeURIComponent(instance)}`,
      apiKey,
      (number) => ({ number, text: `*WEY TRADING - PUNTO VIGILADO*\n\nIndice: *${symbol}*\nEstado: *${stateText}*\nPunto registrado: *${entryPrice}*\n\nEl nivel esta siendo evaluado.` }),
      `Mensaje punto vigilado ${symbol}`,
    );
  }

  private isTextEnabled(): boolean {
    const configured = this.config.get<string>('EVOLUTION_H1_WHATSAPP_ENABLED');
    if (configured?.trim()) return configured.toLowerCase() === 'true';
    return Boolean((this.config.get<string>('APIKEYWHATSAPP') || '').trim());
  }

  private isCallEnabled(): boolean {
    return (this.config.get<string>('EVOLUTION_H1_CALL_ENABLED') || '').toLowerCase() === 'true';
  }

  private async sendChannelNotification(
    dedupeKey: string,
    recipients: string[],
    endpoint: string,
    apiKey: string,
    buildPayload: (number: string) => Record<string, unknown>,
    channelLabel: string,
  ): Promise<void> {
    const now = Date.now();
    const pendingRecipients = recipients.filter((recipient) => {
      const recipientKey = `${dedupeKey}:${recipient}`;
      if (this.notifiedWindows.has(recipientKey)) return false;
      const lastAttempt = this.attemptedWindows.get(recipientKey) || 0;
      if (now - lastAttempt < 30_000) return false;
      this.attemptedWindows.set(recipientKey, now);
      return true;
    });
    if (!pendingRecipients.length) return;

    const results = await Promise.allSettled(
      pendingRecipients.map(async (recipient) => {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            apikey: apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(buildPayload(recipient)),
          signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) {
          const detail = (await response.text()).slice(0, 300);
          throw new Error(`Evolution respondio ${response.status}: ${detail}`);
        }

        this.logger.log(`${channelLabel} enviado a ${this.maskRecipient(recipient)}.`);
        return recipient;
      }),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error(
          `No se pudo enviar ${channelLabel.toLowerCase()}: ${result.reason?.message ?? result.reason}`,
        );
      } else {
        this.notifiedWindows.set(`${dedupeKey}:${result.value}`, Date.now());
      }
    }
  }

  private buildH1TextMessage(alerts: H1AnticipatedCallAlert[], targetHour: string): string {
    const markets = [...new Map(
      alerts.map((alert) => [alert.symbol, alert.mercado || alert.symbol]),
    ).values()];
    const marketLines = alerts.map((alert) => {
      const market = alert.mercado || alert.symbol;
      const trend = alert.h4Trend && alert.h4Trend !== 'NEUTRAL'
        ? ` - H4 ${alert.h4Trend}${alert.h4AgainstTrade ? ' (EN CONTRA)' : ''}`
        : '';
      return `- ${market}${trend}`;
    });
    const againstMarkets = alerts
      .filter((alert) => alert.h4AgainstTrade)
      .map((alert) => alert.mercado || alert.symbol);
    const reactionLines = alerts
      .filter((alert) => alert.historicalReaction?.found)
      .map((alert) => {
        const reaction = alert.historicalReaction!;
        const reactionDate = reaction.lastReactionAt
          ? new Intl.DateTimeFormat('es-CO', {
              timeZone: 'America/Bogota',
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(reaction.lastReactionAt))
          : 'sin fecha';
        const countLabel = reaction.count === 1 ? '1 reaccion' : `${reaction.count} reacciones`;
        return `- ${alert.mercado || alert.symbol}: ${countLabel} cerca de ${reaction.level}. Ultima: ${reactionDate}, ${reaction.lastDirection}, ${reaction.lastMovePoints} puntos.`;
      });
    const targetDate = new Date(targetHour);
    const formattedHour = Number.isNaN(targetDate.getTime())
      ? targetHour
      : new Intl.DateTimeFormat('es-CO', {
        timeZone: 'America/Bogota',
        hour: 'numeric',
        minute: '2-digit',
      }).format(targetDate);

    const timingMessage = alerts.some((alert) => alert.isAnticipated)
      ? 'Posible entrada detectada 2 minutos antes del cierre.'
      : 'Señal H1 confirmada al cierre de la vela.';

    return [
      '*WEY TRADING - ALERTA H1*',
      '',
      timingMessage,
      '',
      markets.length === 1 ? '*Indice:*' : '*Indices:*',
      ...marketLines,
      '',
      `Hora objetivo: ${formattedHour}`,
      ...(againstMarkets.length
        ? [
            '',
            `*ADVERTENCIA:* Evalua bien antes de operar; la tendencia H4 esta en contra para ${againstMarkets.join(', ')}.`,
          ]
        : []),
      ...(reactionLines.length
        ? ['', '*REACCION HISTORICA EN EL NIVEL:*', ...reactionLines]
        : []),
      'Revisa el grafico antes de operar.',
    ].join('\n');
  }

  private async getH1Recipients(): Promise<string[]> {
    const users = await this.usersService.findRecipientsForH1();
    return this.formatPhoneNumbers(users);
  }

  private async getAllRecipients(): Promise<string[]> {
    const users = await this.usersService.findRecipientsForAll();
    return this.formatPhoneNumbers(users);
  }

  private formatPhoneNumbers(
    users: Array<{ countryCallingCode?: string | null; phoneNumber?: string | null }>,
  ): string[] {
    return [
      ...new Set(
        users
          .filter((user) => user.phoneNumber)
          .map((user) =>
            `${user.countryCallingCode || ''}${user.phoneNumber || ''}`.replace(/\D/g, ''),
          )
          .filter((number) => number.length >= 8),
      ),
    ];
  }

  private cleanupOldWindows() {
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    for (const [key, timestamp] of this.notifiedWindows.entries()) {
      if (timestamp < cutoff) this.notifiedWindows.delete(key);
    }
    for (const [key, timestamp] of this.attemptedWindows.entries()) {
      if (timestamp < cutoff) this.attemptedWindows.delete(key);
    }
  }

  private maskRecipient(recipient: string): string {
    if (recipient.endsWith('@g.us')) return 'grupo WhatsApp configurado';
    return recipient.length <= 4
      ? recipient
      : `${'*'.repeat(recipient.length - 4)}${recipient.slice(-4)}`;
  }
}
