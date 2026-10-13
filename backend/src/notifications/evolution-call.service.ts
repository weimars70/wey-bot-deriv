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

    // ── REGLA CRÍTICA USUARIO: Se envía SOLO en el minuto 58 anterior o al minuto 00 ──
    const now = new Date();
    const currentMinute = now.getMinutes();
    if (currentMinute !== 58 && currentMinute !== 0) {
      this.logger.debug(
        `[H1 ALERTA] Minuto ${currentMinute} omitido. H1 solo se envía en minuto 58 o 00.`,
      );
      return;
    }

    await Promise.all(
      validAlerts.map((alert) => this.publishH1CenterAlert(alert, deliveryWindow)),
    );

    this.cleanupOldWindows();

    // ── Enviar a Telegram cada alerta H1 sin mecha ──
    for (const alert of validAlerts) {
      const alertKey = `H1_NOWICK:${alert.symbol}:${alert.closedAt}:${deliveryWindow}`;
      const message = this.buildH1TextMessage([alert], alert.closedAt);
      void this.sendTelegramNotification(
        alertKey,
        message,
        `Alerta H1 Sin Mecha ${alert.symbol}`,
      ).catch((err) => {
        this.logger.error(`Error enviando alerta H1 a Telegram: ${err?.message || err}`);
      });
    }

    const textEnabled = this.isTextEnabled();
    const callEnabled = this.isCallEnabled();
    if (!textEnabled && !callEnabled) {
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
      return;
    }

    this.cleanupOldWindows();

    const duration = Math.min(
      30,
      Math.max(3, Number(this.config.get<string>('EVOLUTION_H1_CALL_DURATION_SECONDS')) || 12),
    );
    const notifications = validAlerts.flatMap((alert) => {
      const alertKey = `${alert.closedAt}:${deliveryWindow}:${alert.symbol}`;
      const message = this.buildH1TextMessage([alert], alert.closedAt);
      const pending: Promise<void>[] = [];

      if (textEnabled) {
        pending.push(this.sendChannelNotification(
          `H1:text:${alertKey}`,
          recipients,
          `${url}/message/sendText/${encodeURIComponent(instance)}`,
          apiKey,
          (number) => ({ number, text: message }),
          `Mensaje H1 ${alert.symbol}`,
        ));
      }

      if (callEnabled) {
        pending.push(this.sendChannelNotification(
          `H1:call:${alertKey}`,
          recipients.filter((recipient) => !recipient.endsWith('@g.us')),
          `${url}/call/offer/${encodeURIComponent(instance)}`,
          apiKey,
          (number) => ({ number, isVideo: false, callDuration: duration }),
          `Llamada H1 ${alert.symbol}`,
        ));
      }

      return pending;
    });

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

  async notifyGapSpikeAlert(data: {
    symbol: string;
    direction: 'BUY' | 'SELL';
    entryPrice: number;
    currentPrice: number;
    distance: number;
    minutesToArrival: number;
    trendM15: 'ALCISTA' | 'BAJISTA';
    ema50_M15: number;
    consecutiveRetracementM1?: number;
    note?: string | null;
  }): Promise<boolean> {
    const isBoom = data.direction === 'BUY' || data.symbol.includes('BOOM');
    const cleanSymbol = data.symbol.toUpperCase();
    const expectedTrend = isBoom ? 'ALCISTA' : 'BAJISTA';

    // ── REGLA CRÍTICA USUARIO: "debe de estar en tendencia segun el indice" ──
    // Boom DEBE ser ALCISTA. Crash DEBE ser BAJISTA. Si no coincide, NUNCA enviar.
    if (data.trendM15 !== expectedTrend) {
      this.logger.warn(
        `[GAP SPIKE] Mensaje descartado: ${cleanSymbol} tendencia M15 es ${data.trendM15}, pero requiere ${expectedTrend} según el índice.`,
      );
      return false;
    }

    const actionLabel = isBoom ? 'BOOM BUY ZONAS' : 'CRASH SELL ZONAS';
    const spikeType = isBoom ? 'SPIKE ALCISTA 🚀' : 'SPIKE BAJISTA 💥';
    const alertKey = `GAP_SPIKE:${cleanSymbol}:${data.entryPrice.toFixed(2)}`;

    // 1. Emitir alerta visual y sonora al centro de notificaciones / voz
    try {
      await this.publishCenterAlert({
        type: 'GAP_SPIKE_ANTICIPATION',
        symbol: cleanSymbol,
        title: `🚨 Posible Spike en ${cleanSymbol}`,
        message: `A ~2 min del Gap ${data.entryPrice.toFixed(2)} (${data.distance.toFixed(2)} pts) en retroceso. Tendencia M15 ${data.trendM15}.`,
        speechText: `Atención. Posible spike en ${cleanSymbol}. Índice a dos minutos del Gap en retroceso con tendencia M15 a favor.`,
        targetPath: '/crash-ia',
        routeQuery: { symbol: cleanSymbol },
        severity: 'warning',
        dedupeKey: `CENTER:GAP:${cleanSymbol}:${data.entryPrice.toFixed(2)}:${Math.floor(Date.now() / 120_000)}`,
      });
    } catch (e: any) {
      this.logger.debug(`Error emitiendo alerta interna de Gap: ${e?.message}`);
    }

    // 2. Enviar a Telegram
    const token = (this.config.get<string>('TELEGRAM_BOT_TOKEN') || '').trim();
    const chatId = (this.config.get<string>('TELEGRAM_CHAT_ID') || '').trim();
    if (!token || !chatId) {
      this.logger.warn('[GAP SPIKE] Telegram no configurado (TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID vacío).');
      return false;
    }

    this.cleanupOldWindows();
    const notificationKey = `TELEGRAM:${chatId}:${alertKey}`;
    const now = Date.now();
    if (this.notifiedWindows.has(notificationKey)) return false;
    const lastAttempt = this.attemptedWindows.get(notificationKey) || 0;
    // Cooldown de 30 minutos por nivel para no saturar si oscila cerca de 2 minutos
    if (now - lastAttempt < 30 * 60_000) return false;
    this.attemptedWindows.set(notificationKey, now);

    // Candado distribuido en PostgreSQL para evitar duplicados entre Local y VPS
    const claimed = await this.signalCenter.claimTelegramDispatch(notificationKey);
    if (!claimed) {
      this.logger.debug(`[TELEGRAM LOCK] Gap alert ${alertKey} ya despachada por otra instancia.`);
      return false;
    }

    const checkedAt = new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());

    const retracementLine = data.consecutiveRetracementM1
      ? `📉 *Retroceso M1:* *${data.consecutiveRetracementM1} velas ${isBoom ? 'rojas' : 'verdes'}* ✅ PEQUEÑO RETROCESO ACTIVO`
      : `📉 *Retroceso:* ✅ Pequeño retroceso hacia el Gap`;

    const message = [
      `🚨 *POSIBLE SPIKE EN RETROCESO (GAP)* 🚨`,
      `*Estrategia:* Zonas V y H1 · ${actionLabel}`,
      `*Hora:* ${checkedAt} (Col)`,
      ``,
      `📊 *Índice:* *${cleanSymbol}*`,
      `🎯 *Nivel Gap:* \`${data.entryPrice.toFixed(2)}\``,
      `📍 *Precio Actual:* \`${data.currentPrice.toFixed(2)}\``,
      `📏 *Distancia:* \`${data.distance.toFixed(2)} pts\``,
      `⏳ *Tiempo Estimado:* *~2 MINUTOS ANTES* (~${data.minutesToArrival.toFixed(1)} min)`,
      `📈 *Tendencia M15:* *${data.trendM15}* ✅ A FAVOR (${isBoom ? 'ALCISTA para BOOM' : 'BAJISTA para CRASH'} - EMA50: ${data.ema50_M15.toFixed(2)})`,
      retracementLine,
      ...(data.note ? [`📝 *Detalle:* ${data.note}`] : []),
      ``,
      `⚠️ *Acción:* El índice se aproxima al Gap en retroceso con tendencia M15 a favor. Preparar entrada para posible ${spikeType}.`,
    ].join('\n');

    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      const result = (await response.json()) as { ok?: boolean; description?: string };
      if (!response.ok || !result.ok) {
        throw new Error(`Telegram error ${response.status}: ${result.description || 'desconocido'}`);
      }

      this.notifiedWindows.set(notificationKey, Date.now());
      this.logger.log(`[GAP SPIKE] 🚨 Alerta de posible spike enviada a Telegram: ${cleanSymbol} Gap ${data.entryPrice.toFixed(2)}.`);
      return true;
    } catch (error: any) {
      this.logger.error(`[GAP SPIKE] Error enviando alerta a Telegram: ${error?.message || error}`);
      return false;
    }
  }

  async notifyCrashBoomAlerts(
    evaluations: Array<Omit<CrashIaEvaluation, 'chartCandles'>>,
    deliveryWindow: string,
  ): Promise<void> {
    const confirmedSignals = evaluations.filter((item) =>
      item.marketType === 'BOOM' ? item.canBuy : item.canSell,
    );
    if (!confirmedSignals.length) return;

    await Promise.all(
      confirmedSignals.map((item) => this.publishCrashBoomCenterAlert(item, deliveryWindow)),
    );

    const stateKey = confirmedSignals
      .map((item) => [
        item.symbol,
        item.canBuy || item.canSell ? 'READY' : item.status,
        item.filters.trendOk ? 'T1' : 'T0',
        item.filters.greenOk ? 'C1' : 'C0',
        item.m5Viability?.isViable ? 'M1' : 'M0',
      ].join(':'))
      .sort()
      .join(',');
    const telegramText = this.buildCrashBoomTextMessage(confirmedSignals);
    if (!telegramText) {
      this.logger.log('[CRASH/BOOM TELEGRAM] Sin señales con todos los filtros completos; no se envia mensaje a Telegram.');
      return;
    }
    const telegramNotification = this.sendTelegramNotification(
      `CRASH_BOOM:${deliveryWindow}:${stateKey}`,
      telegramText,
      `Posible spike Crash/Boom ${confirmedSignals.map((item) => item.symbol).join(', ')}`,
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
        (number) => ({ number, text: this.buildCrashBoomTextMessage(confirmedSignals) }),
        `Posible spike Crash/Boom ${confirmedSignals.map((item) => item.symbol).join(', ')}`,
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
    if (!ready) return;

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

    const rsiRequirement = isBoom ? '<=35' : '>=65';
    if (item.filters.rsiOk) fulfilled.push(`RSI M5 ${item.filters.rsi_M5} (${rsiRequirement})`);
    else missing.push(`RSI M5 ${item.filters.rsi_M5} (requiere ${rsiRequirement})`);

    if (item.activeOrderBlock?.status === 'EN_ZONA') fulfilled.push('precio dentro del OB');

    await this.publishCenterAlert({
      type: `${isBoom ? 'BOOM_BUY' : 'CRASH_SELL'}_CONFIRMED`,
      symbol: item.symbol,
      title: `LISTO ${direction}: ${item.mercado || item.symbol}`,
      message: [
        `Precio ${item.currentPrice}`,
        `Cumple: ${fulfilled.length ? fulfilled.join(', ') : 'todos los filtros'}`,
        `Falta: nada`,
        `SL ${item.stopLossPrice}`,
      ].join(' | '),
      speechText: `Atencion. ${item.mercado || item.symbol} listo para ${isBoom ? 'compra' : 'venta'}. Revise la entrada.`,
      targetPath: '/crash-ia',
      routeQuery: { symbol: item.symbol },
      severity: 'positive',
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
    const configured = this.config.get<string | boolean>('EVOLUTION_H1_WHATSAPP_ENABLED');
    if (typeof configured === 'boolean') return configured;
    if (typeof configured === 'string' && configured.trim().length > 0) {
      return configured.trim().toLowerCase() === 'true';
    }
    return false;
  }

  private isCallEnabled(): boolean {
    const configured = this.config.get<string | boolean>('EVOLUTION_H1_CALL_ENABLED');
    if (typeof configured === 'boolean') return configured;
    if (typeof configured === 'string' && configured.trim().length > 0) {
      return configured.trim().toLowerCase() === 'true';
    }
    return false;
  }

  private async sendTelegramNotification(
    dedupeKey: string,
    text: string,
    channelLabel: string,
  ): Promise<void> {
    if (/AUN NO ENTRAR/i.test(text)) {
      this.logger.warn(`Mensaje ${channelLabel} omitido: contiene una señal marcada AUN NO ENTRAR.`);
      return;
    }
    // Solo enviar si no hay condiciones pendientes (Falta: debe ser 'nada')
    if (/Falta:\s*(?!nada)[^\n]+/i.test(text)) {
      this.logger.warn(`Mensaje ${channelLabel} omitido: contiene condiciones pendientes (Falta: no es 'nada').`);
      return;
    }

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

    // Candado distribuido en PostgreSQL para evitar duplicados entre Local y VPS
    const claimed = await this.signalCenter.claimTelegramDispatch(notificationKey);
    if (!claimed) {
      this.logger.debug(`[TELEGRAM LOCK] ${dedupeKey} ya despachado por otra instancia.`);
      return;
    }

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
    const isAnticipated = alerts.some((alert) => alert.isAnticipated);
    const timingBadge = isAnticipated
      ? '⚡ *Entrada Anticipada (Minuto 58 - 2 min antes del cierre)*'
      : '🎯 *Cierre H1 Confirmado (Minuto 00)*';

    const targetDate = new Date(targetHour);
    const formattedHour = Number.isNaN(targetDate.getTime())
      ? targetHour
      : new Intl.DateTimeFormat('es-CO', {
          timeZone: 'America/Bogota',
          hour: 'numeric',
          minute: '2-digit',
        }).format(targetDate);

    const alertSections = alerts.map((alert) => {
      const market = alert.mercado || alert.symbol;
      const isBoom = (alert.symbol || '').toUpperCase().includes('BOOM');
      const action = isBoom ? 'BUY (COMPRA)' : 'SELL (VENTA)';
      const candleColor = isBoom ? 'BAJISTA 🔴' : 'ALCISTA 🟢';

      const lines = [
        `📊 *Índice:* *${market}*`,
        `📈 *Operación:* *${action}*`,
        `🕯️ *Vela H1:* ${candleColor} cerrando *SIN MECHA* (Marubozu)`,
      ];

      if (alert.h4Trend && alert.h4Trend !== 'NEUTRAL') {
        const warning = alert.h4AgainstTrade ? ' ⚠️ *(EN CONTRA)*' : ' ✅ *(A FAVOR)*';
        lines.push(`🧭 *Tendencia H4:* ${alert.h4Trend}${warning}`);
      }

      if (alert.historicalReaction?.found) {
        const reaction = alert.historicalReaction;
        const reactionDate = reaction.lastReactionAt
          ? new Intl.DateTimeFormat('es-CO', {
              timeZone: 'America/Bogota',
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(reaction.lastReactionAt))
          : 'sin fecha';
        const countLabel = reaction.count === 1 ? '1 reacción' : `${reaction.count} reacciones`;
        lines.push(
          `🎯 *Reacción Histórica:* ${countLabel} cerca de \`${reaction.level}\` (Última: ${reactionDate}, ${reaction.lastDirection}, ${reaction.lastMovePoints} pts)`,
        );
      }

      return lines.join('\n');
    });

    return [
      `🕯️ *WEY TRADING - ALERTA H1 SIN MECHA* 🕯️`,
      timingBadge,
      `⏰ *Hora Objetivo:* ${formattedHour} (Col)`,
      ``,
      ...alertSections,
      ``,
      `⚠️ *Acción:* Revisar gráfico en H1. Si la vela termina sin mecha, preparar entrada inmediata.`,
    ].join('\n');
  }

  private buildCrashBoomTextMessage(
    evaluations: Array<Omit<CrashIaEvaluation, 'chartCandles'>>,
  ): string {
    const confirmedSignals = evaluations.filter((item) =>
      item.marketType === 'BOOM' ? item.canBuy : item.canSell,
    );
    if (!confirmedSignals.length) return '';

    const checkedAt = new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());

    const sections: string[] = [];

    for (const item of confirmedSignals) {
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

      const rsiRequirement = isBoom ? '<=35' : '>=65';
      if (item.filters.rsiOk) fulfilled.push(`RSI M5 ${item.filters.rsi_M5} (${rsiRequirement})`);
      else missing.push(`RSI M5 ${item.filters.rsi_M5} (requiere ${rsiRequirement})`);

      if (item.activeOrderBlock?.status === 'EN_ZONA') fulfilled.push('precio dentro del OB');

      // Solo incluir en el mensaje de Telegram cuando todos los filtros están completos
      if (missing.length > 0) {
        this.logger.log(
          `[CRASH/BOOM TELEGRAM] ${item.mercado || item.symbol} omitido del mensaje: Falta ${missing.join(', ')}.`,
        );
        continue;
      }

      sections.push(
        `*LISTO ${direction} - ${item.mercado || item.symbol}*`,
        `Precio: ${item.currentPrice} | SL: ${item.stopLossPrice}`,
        `Cumple: ${fulfilled.join(', ')}`,
        `Falta: nada`,
        '',
      );
    }

    if (!sections.length) return '';

    return [
      '*WEY TRADING - SEÑAL CONFIRMADA*',
      `Evaluacion: ${checkedAt}`,
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
