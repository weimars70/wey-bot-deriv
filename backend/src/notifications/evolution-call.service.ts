import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import type { CrashIaEvaluation } from '../strategies/crash-ia-strategy.service';
import { PublishSignalCenterAlert, SignalCenterService } from './signal-center.service';

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
    private readonly signalCenter: SignalCenterService,
  ) {}

  async notifyH1Alerts(
    alerts: H1AnticipatedCallAlert[],
    deliveryWindow = 'signal',
  ): Promise<void> {
    const validAlerts = alerts.filter((alert) => alert?.symbol && alert?.closedAt);
    if (!validAlerts.length) return;

    await Promise.all(
      validAlerts.map((alert) => this.publishH1CenterAlert(alert, deliveryWindow)),
    );

    const targetHour = validAlerts
      .map((alert) => alert.closedAt)
      .filter(Boolean)
      .sort()[0] || new Date().toISOString().slice(0, 13);
    const h1Key = `${targetHour}:${deliveryWindow}:${validAlerts.map((alert) => alert.symbol).sort().join(',')}`;
    const telegramNotification = this.sendTelegramNotification(
      `H1:${h1Key}`,
      this.buildH1TextMessage(validAlerts, targetHour),
      `Mensaje H1 ${validAlerts.map((alert) => alert.symbol).sort().join(', ')}`,
    );

    const textEnabled = this.isTextEnabled();
    const callEnabled = this.isCallEnabled();
    if (!textEnabled && !callEnabled) {
      await telegramNotification;
      return;
    }

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
      await telegramNotification;
      return;
    }

    this.cleanupOldWindows();

    const notifications: Promise<void>[] = [telegramNotification];
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
    const stateText = state === 'EN_PUNTO' ? 'EN PUNTO REGISTRADO' : 'LLEGANDO A PUNTO REGISTRADO';
    const minuteBucket = Math.floor(Date.now() / 60_000);
    await this.publishCenterAlert({
      type: `WATCHED_LEVEL_${state}`,
      symbol,
      title: `Punto vigilado: ${symbol}`,
      message: `${stateText} | Nivel: ${entryPrice} | El nivel esta siendo evaluado.`,
      speechText: `Atencion. ${symbol} ${state === 'EN_PUNTO' ? 'esta en el punto registrado' : 'esta llegando al punto registrado'}.`,
      targetPath: '/watched-levels',
      routeQuery: { symbol },
      severity: state === 'EN_PUNTO' ? 'positive' : 'warning',
      dedupeKey: `CENTER:LEVEL:${symbol}:${entryPrice}:${state}:${minuteBucket}`,
    });

    if (!this.isTextEnabled()) return;
    const url = (this.config.get<string>('EVOLUTION_API_URL') || 'http://2.58.80.90:3024').replace(/\/+$/, '');
    const instance = (this.config.get<string>('EVOLUTION_INSTANCE') || 'wey-trading-bot').trim();
    const apiKey = (this.config.get<string>('EVOLUTION_API_KEY') || this.config.get<string>('APIKEYWHATSAPP') || '').trim();
    const recipients = await this.getAllRecipients();
    if (!apiKey || !recipients.length) return;
    await this.sendChannelNotification(
      `LEVEL:${symbol}:${entryPrice}:${state}`,
      recipients,
      `${url}/message/sendText/${encodeURIComponent(instance)}`,
      apiKey,
      (number) => ({ number, text: `*WEY TRADING - PUNTO VIGILADO*\n\nIndice: *${symbol}*\nEstado: *${stateText}*\nPunto registrado: *${entryPrice}*\n\nEl nivel esta siendo evaluado.` }),
      `Mensaje punto vigilado ${symbol}`,
    );
  }

  async notifyCrashBoomAlerts(
    evaluations: Array<Omit<CrashIaEvaluation, 'chartCandles'>>,
    deliveryWindow: string,
  ): Promise<void> {
    if (!evaluations.length) return;

    await Promise.all(
      evaluations.map((item) => this.publishCrashBoomCenterAlert(item, deliveryWindow)),
    );

    const stateKey = evaluations
      .map((item) => [
        item.symbol,
        item.canBuy || item.canSell ? 'READY' : item.status,
        item.filters.trendOk ? 'T1' : 'T0',
        item.filters.greenOk ? 'C1' : 'C0',
        item.m5Viability?.isViable ? 'M1' : 'M0',
      ].join(':'))
      .sort()
      .join(',');
    const telegramNotification = this.sendTelegramNotification(
      `CRASH_BOOM:${deliveryWindow}:${stateKey}`,
      this.buildCrashBoomTextMessage(evaluations),
      `Mensaje Crash/Boom ${evaluations.map((item) => item.symbol).join(', ')}`,
    );

    if (!this.isTextEnabled()) {
      await telegramNotification;
      return;
    }

    const url = (this.config.get<string>('EVOLUTION_API_URL') || 'http://2.58.80.90:3024').replace(/\/+$/, '');
    const instance = (this.config.get<string>('EVOLUTION_INSTANCE') || 'wey-trading-bot').trim();
    const apiKey = (this.config.get<string>('EVOLUTION_API_KEY') || this.config.get<string>('APIKEYWHATSAPP') || '').trim();
    const recipients = await this.getAllRecipients();
    if (!url || !instance || !apiKey || !recipients.length) {
      this.logger.warn('Alertas Crash/Boom por WhatsApp habilitadas, pero faltan datos de Evolution API o destinatarios.');
      await telegramNotification;
      return;
    }
    this.cleanupOldWindows();

    await Promise.all([
      telegramNotification,
      this.sendChannelNotification(
        `CRASH_BOOM:${deliveryWindow}:${stateKey}`,
        recipients,
        `${url}/message/sendText/${encodeURIComponent(instance)}`,
        apiKey,
        (number) => ({ number, text: this.buildCrashBoomTextMessage(evaluations) }),
        `Mensaje Crash/Boom ${evaluations.map((item) => item.symbol).join(', ')}`,
      ),
    ]);
  }

  private async publishH1CenterAlert(
    alert: H1AnticipatedCallAlert,
    deliveryWindow: string,
  ): Promise<void> {
    const anticipated = Boolean(alert.isAnticipated);
    const market = alert.mercado || alert.symbol;
    const direction = String(alert.direction || 'SEÑAL').toUpperCase();
    const details = [
      anticipated
        ? 'Posible entrada detectada 2 minutos antes del cierre.'
        : 'Señal H1 confirmada al cierre de la vela.',
    ];

    if (alert.h4Trend && alert.h4Trend !== 'NEUTRAL') {
      details.push(`Tendencia H4: ${alert.h4Trend}${alert.h4AgainstTrade ? ' (EN CONTRA)' : ''}.`);
    }
    if (alert.historicalReaction?.found) {
      const reaction = alert.historicalReaction;
      details.push(
        `${reaction.count} reaccion(es) historica(s) cerca de ${reaction.level}; ultima ${reaction.lastDirection}, recorrido ${reaction.lastMovePoints} puntos.`,
      );
    }
    details.push('Revisa el grafico antes de operar.');

    await this.publishCenterAlert({
      type: 'H1_NO_WICK',
      symbol: alert.symbol,
      title: `H1 ${anticipated ? 'ANTICIPADA ' : ''}${direction} - ${market}`,
      message: details.join(' | '),
      speechText: `Radar H uno. ${anticipated ? 'Señal anticipada' : 'Señal confirmada'} ${direction.toLowerCase()} en ${market}.`,
      targetPath: '/h1-strategy',
      routeQuery: { symbol: alert.symbol },
      severity: alert.h4AgainstTrade ? 'negative' : 'warning',
      dedupeKey: `CENTER:H1:${deliveryWindow}:${alert.symbol}:${alert.closedAt}:${anticipated ? 'A' : 'C'}`,
    });
  }

  private async publishCrashBoomCenterAlert(
    item: Omit<CrashIaEvaluation, 'chartCandles'>,
    deliveryWindow: string,
  ): Promise<void> {
    const isBoom = item.marketType === 'BOOM';
    const direction = isBoom ? 'BUY' : 'SELL';
    const ready = isBoom ? item.canBuy : item.canSell;
    const count = isBoom
      ? item.filters.consecutiveRedM1
      : item.filters.consecutiveGreenM1;
    const required = item.filters.minGreenRequired || 3;
    const color = isBoom ? 'rojas' : 'verdes';
    const expectedTrend = isBoom ? 'alcista' : 'bajista';
    const inRetest = item.status === 'EN_RETESTEO'
      || (item.retestZone?.isInRetest && !item.retestZone.isReadyForEntry);
    const fulfilled: string[] = [];
    const missing: string[] = [];

    if (item.status === 'EN_ZONA_50' || item.status === 'EN_RETESTEO') {
      fulfilled.push('zona de precio activa');
    } else if (ready) {
      fulfilled.push('reaccion M5 valida');
    } else if (item.status === 'EN_BASE_CAJA') {
      missing.push(`llegar al 50% (${item.entryLevel50})`);
    }

    if (item.filters.trendOk) fulfilled.push(`tendencia M15 ${expectedTrend}`);
    else missing.push(`tendencia M15 ${expectedTrend}`);

    if (item.filters.greenOk) fulfilled.push(`${count} velas ${color} M1`);
    else missing.push(`${Math.max(0, required - count)} vela(s) ${color} M1 (${count}/${required})`);

    if (inRetest) missing.push('salir del retesteo M5');
    else if (item.m5Viability?.isViable) fulfilled.push('confirmacion M5');
    else missing.push(`M5: ${this.compactReason(item.m5Viability?.reason)}`);

    if (item.activeOrderBlock?.status === 'EN_ZONA') fulfilled.push('precio dentro del OB');

    await this.publishCenterAlert({
      type: ready
        ? `${isBoom ? 'BOOM_BUY' : 'CRASH_SELL'}_CONFIRMED`
        : `${isBoom ? 'BOOM' : 'CRASH'}_REVIEW`,
      symbol: item.symbol,
      title: ready
        ? `LISTO ${direction}: ${item.mercado || item.symbol}`
        : `REVISAR ${direction}: ${item.mercado || item.symbol} - AUN NO ENTRAR`,
      message: [
        `Precio ${item.currentPrice}`,
        `Cumple: ${fulfilled.length ? fulfilled.join(', ') : 'ningun filtro completo'}`,
        `Falta: ${missing.length ? missing.join(', ') : 'nada'}`,
        `RSI M5 ${item.filters.rsi_M5} (contexto)`,
        ...(ready ? [`SL ${item.stopLossPrice}`] : []),
      ].join(' | '),
      speechText: ready
        ? `Atencion. ${item.mercado || item.symbol} listo para ${isBoom ? 'compra' : 'venta'}. Revise la entrada.`
        : `Revise ${item.mercado || item.symbol} para ${isBoom ? 'compra' : 'venta'}. Aun no entrar.`,
      targetPath: '/crash-ia',
      routeQuery: { symbol: item.symbol },
      severity: ready ? 'positive' : 'warning',
      dedupeKey: `CENTER:CRASH_BOOM:${deliveryWindow}:${item.symbol}`,
    });
  }

  private async publishCenterAlert(input: PublishSignalCenterAlert): Promise<void> {
    try {
      await this.signalCenter.publish(input);
    } catch (error: any) {
      this.logger.error(`No se pudo publicar en el centro de alertas: ${error?.message || error}`);
    }
  }

  private isTextEnabled(): boolean {
    const configured = this.config.get<string>('EVOLUTION_H1_WHATSAPP_ENABLED');
    if (configured?.trim()) return configured.toLowerCase() === 'true';
    return Boolean((this.config.get<string>('APIKEYWHATSAPP') || '').trim());
  }

  private isCallEnabled(): boolean {
    return (this.config.get<string>('EVOLUTION_H1_CALL_ENABLED') || '').toLowerCase() === 'true';
  }

  private async sendTelegramNotification(
    dedupeKey: string,
    text: string,
    channelLabel: string,
  ): Promise<void> {
    const token = (this.config.get<string>('TELEGRAM_BOT_TOKEN') || '').trim();
    const chatId = (this.config.get<string>('TELEGRAM_CHAT_ID') || '').trim();
    if (!token || !chatId) return;

    this.cleanupOldWindows();
    const notificationKey = `TELEGRAM:${chatId}:${dedupeKey}`;
    const now = Date.now();
    if (this.notifiedWindows.has(notificationKey)) return;
    const lastAttempt = this.attemptedWindows.get(notificationKey) || 0;
    if (now - lastAttempt < 30_000) return;
    this.attemptedWindows.set(notificationKey, now);

    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json() as { ok?: boolean; description?: string };
      if (!response.ok || !result.ok) {
        throw new Error(`Telegram respondio ${response.status}: ${result.description || 'error desconocido'}`);
      }

      this.notifiedWindows.set(notificationKey, Date.now());
      this.logger.log(`${channelLabel} enviado a Telegram.`);
    } catch (error: any) {
      this.logger.error(`No se pudo enviar ${channelLabel.toLowerCase()} a Telegram: ${error?.message ?? error}`);
    }
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

  private buildCrashBoomTextMessage(
    evaluations: Array<Omit<CrashIaEvaluation, 'chartCandles'>>,
  ): string {
    const checkedAt = new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
    const sections = evaluations.flatMap((item) => {
      const isBoom = item.marketType === 'BOOM';
      const direction = isBoom ? 'BUY' : 'SELL';
      const ready = isBoom ? item.canBuy : item.canSell;
      const count = isBoom
        ? item.filters.consecutiveRedM1
        : item.filters.consecutiveGreenM1;
      const required = item.filters.minGreenRequired || 3;
      const color = isBoom ? 'rojas' : 'verdes';
      const expectedTrend = isBoom ? 'alcista' : 'bajista';
      const inRetest = item.status === 'EN_RETESTEO'
        || (item.retestZone?.isInRetest && !item.retestZone.isReadyForEntry);
      const fulfilled: string[] = [];
      const missing: string[] = [];

      if (item.status === 'EN_ZONA_50' || item.status === 'EN_RETESTEO') {
        fulfilled.push('zona de precio activa');
      } else if (ready) {
        fulfilled.push('reaccion M5 valida');
      } else if (item.status === 'EN_BASE_CAJA') {
        missing.push(`llegar al 50% (${item.entryLevel50})`);
      }

      if (item.filters.trendOk) fulfilled.push(`tendencia M15 ${expectedTrend}`);
      else missing.push(`tendencia M15 ${expectedTrend}`);

      if (item.filters.greenOk) fulfilled.push(`${count} velas ${color} M1`);
      else missing.push(`${Math.max(0, required - count)} vela(s) ${color} M1 (${count}/${required})`);

      if (inRetest) missing.push('salir del retesteo M5');
      else if (item.m5Viability?.isViable) fulfilled.push('confirmacion M5');
      else missing.push(`M5: ${this.compactReason(item.m5Viability?.reason)}`);

      if (item.activeOrderBlock?.status === 'EN_ZONA') fulfilled.push('precio dentro del OB');

      return [
        `*${ready ? 'LISTO' : 'REVISAR'} ${direction} - ${item.mercado || item.symbol}${ready ? '' : ' (AUN NO ENTRAR)'}*`,
        `Precio: ${item.currentPrice}${ready ? ` | SL: ${item.stopLossPrice}` : ''}`,
        `Cumple: ${fulfilled.length ? fulfilled.join(', ') : 'ningun filtro completo'}`,
        `Falta: ${missing.length ? missing.join(', ') : 'nada'}`,
        `Contexto: RSI M5 ${item.filters.rsi_M5}`,
        '',
      ];
    });

    return [
      '*WEY TRADING - ZONAS V Y H1*',
      `Evaluacion programada: ${checkedAt}`,
      '',
      ...sections,
      'Confirma el grafico antes de operar.',
    ].join('\n');
  }

  private compactReason(reason?: string, maxLength = 100): string {
    const normalized = String(reason || 'esperar confirmacion de reaccion')
      .replace(/\s+/g, ' ')
      .trim();
    return normalized.length > maxLength
      ? `${normalized.slice(0, maxLength - 3)}...`
      : normalized;
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
