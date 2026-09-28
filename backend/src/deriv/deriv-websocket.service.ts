import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as WebSocket from 'ws';

/**
 * Mantiene UNA conexión WebSocket persistente y autenticada con Deriv.
 * Deriv no ofrece un REST equivalente para datos de mercado (ticks/velas/
 * contratos), así que este servicio es el único punto de contacto con su
 * API. Todo lo que llega se re-emite como eventos internos (EventEmitter2)
 * para que otros módulos (ticks, candles, account) lo persistan en Postgres,
 * y el resto de la app (incluido el frontend) solo habla REST con Nest.
 */
@Injectable()
export class DerivWebsocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DerivWebsocketService.name);
  private ws: WebSocket | null = null;
  private isAuthorized = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectDelayMs = 30_000;
  private pingInterval: NodeJS.Timeout | null = null;
  private reqIdCounter = 1;
  private readonly pendingRequests = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: any) => void;
      timer?: NodeJS.Timeout;
      channel?: 'primary' | 'public';
    }
  >();
  // Track active subscriptions to avoid sending duplicate subscribe requests
  private subscribedTicks = new Set<string>();
  private subscribedCandles = new Set<string>();
  private readonly candleRetryAttempts = new Map<string, number>();

  // Feed público para activos no disponibles en cuentas de opciones OTP (100 y 200)
  private publicWs: WebSocket | null = null;
  private publicConnectPromise: Promise<WebSocket> | null = null;
  private publicReconnectAttempts = 0;
  private publicReconnectBlockedUntil = 0;
  private publicPollBlockedUntil = 0;
  private publicPollInFlight = false;
  private publicPollInterval: NodeJS.Timeout | null = null;
  private readonly nonOtpSymbols = new Set(['CRASH100', 'CRASH200', 'BOOM100', 'BOOM200']);
  private readonly unsupportedPublicSymbols = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    this.connect();
    this.publicPollInterval = setInterval(() => {
      this.pollNonOtpCandles().catch((err) =>
        this.logger.debug(`Sondeo público aplazado: ${err?.message ?? err}`),
      );
    }, 30_000);
  }

  onModuleDestroy() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.publicPollInterval) clearInterval(this.publicPollInterval);
    this.ws?.close();
    this.publicWs?.close();
  }

  private connect() {
    const useOtp = this.config.get<string>('DERIV_USE_OTP', 'false') === 'true';
    if (useOtp) {
      this.connectWithOtp().catch((e) =>
        this.logger.error(`Fallo al conectar con OTP: ${e?.message ?? e}`),
      );
      return;
    }

    const appId = this.config.get<string>('DERIV_APP_ID', '1089');
    const baseUrl = this.config.get<string>(
      'DERIV_WS_URL',
      'wss://ws.derivws.com/websockets/v3',
    );
    const url = `${baseUrl}?app_id=${appId}`;

    this.logger.log(`Conectando a Deriv: ${url}`);
    this.ws = new WebSocket(url);

    this.ws.on('open', () => this.onOpen());
    this.ws.on('message', (data) => this.onMessage(data));
    this.ws.on('close', () => this.onClose());
    this.ws.on('error', (err) => this.logger.error(`WS error: ${err.message}`));
  }

  private async onOpen() {
    this.logger.log('✅ Conexión WebSocket con Deriv establecida');
    this.reconnectAttempts = 0;

    // Keep-alive: Deriv cierra conexiones inactivas.
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      this.send({ ping: 1 }).catch((err) => {
        this.logger.debug(`Ping a Deriv no respondió a tiempo: ${err?.message}`);
      });
    }, 25_000);

    const token = this.config.get<string>('DERIV_API_TOKEN');
    if (token) {
      // Mostrar solo una parte del token para confirmar que se leyó (no imprimir secretos completos)
      this.logger.log(`DERIV_API_TOKEN cargado: ${token.slice(0, 6)}... (long=${token.length})`);
      try {
        // Intentamos autorizar; el resultado del authorize llegará en onMessage
        await this.send({ authorize: token });
        this.logger.log('🔐 Petición de autorización enviada (esperando respuesta)');
        // solicitar balance solo si recibimos authorize (onMessage establece isAuthorized)
      } catch (e) {
        this.logger.error(`Fallo al enviar authorize: ${JSON.stringify(e)}`);
      }
    } else {
      this.logger.warn(
        'DERIV_API_TOKEN no configurado: solo se recibirán datos públicos (ticks/velas), sin balance/cuenta.',
      );
    }

    // Suscripción automática a los símbolos configurados en DERIV_SYMBOLS.
    // Ya NO llamamos getActiveSymbols() porque el endpoint OTP no lo soporta
    // y hacerlo causaba timeouts + cancelación de las suscripciones.
    // Si algún símbolo no existe en Deriv, subscribeTicks/subscribeCandles
    // manejan el error silenciosamente.
    const configuredSymbols = this.config
      .get<string>('DERIV_SYMBOLS', 'R_100')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (configuredSymbols.length === 0) {
      this.logger.warn('DERIV_SYMBOLS vacío — no hay suscripciones automáticas desde .env');
      return;
    }

    this.logger.log(`Suscribiendo DERIV_SYMBOLS con retardo escalonado: ${configuredSymbols.join(', ')}`);
    let delay = 0;
    for (const symbol of configuredSymbols) {
      setTimeout(() => {
        this.subscribeTicks(symbol);
        this.subscribeCandles(symbol, 60);
        if (symbol.toUpperCase().startsWith('CRASH') || symbol.toUpperCase().startsWith('BOOM')) {
          setTimeout(() => this.subscribeCandles(symbol, 300), 100);
          setTimeout(() => this.subscribeCandles(symbol, 900), 200);
          setTimeout(() => this.subscribeCandles(symbol, 1800), 300);
          setTimeout(() => this.subscribeCandles(symbol, 3600), 400);
          setTimeout(() => this.subscribeCandles(symbol, 14400), 500);
        }
      }, delay);
      delay += 1500; // Espacia las 5 consultas de cada activo para respetar el rate limit de Deriv
    }
  }

  private onClose() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.isAuthorized = false;
    this.subscribedTicks.clear();
    this.subscribedCandles.clear();

    for (const [, req] of this.pendingRequests.entries()) {
      if (req.timer) clearTimeout(req.timer);
      try {
        req.reject(new Error('Conexión cerrada con Deriv'));
      } catch {}
    }
    this.pendingRequests.clear();

    this.reconnectAttempts++;
    const delay = Math.min(
      1000 * 2 ** this.reconnectAttempts,
      this.maxReconnectDelayMs,
    );
    this.logger.warn(
      `Conexión cerrada. Reintentando en ${delay / 1000}s (intento ${this.reconnectAttempts})`,
    );
    setTimeout(() => this.connect(), delay);
  }

  private onMessage(raw: WebSocket.RawData) {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      this.logger.error('Mensaje no JSON recibido de Deriv, se ignora');
      return;
    }

    if (msg.error) {
      const pendingChannel = msg.req_id
        ? this.pendingRequests.get(msg.req_id)?.channel
        : undefined;
      const requestedSymbol = String(msg.echo_req?.ticks_history || '').toUpperCase();

      if (msg.error?.code === 'RateLimit' && pendingChannel === 'public') {
        this.publicPollBlockedUntil = Date.now() + 60_000;
        this.logger.warn('RateLimit en sondeo público de velas. Se pausa durante 60s.');
      } else if (msg.error?.code === 'InvalidSymbol' && pendingChannel === 'public' && requestedSymbol) {
        if (!this.unsupportedPublicSymbols.has(requestedSymbol)) {
          this.unsupportedPublicSymbols.add(requestedSymbol);
          this.logger.warn(
            `Deriv Public API no ofrece actualmente ${requestedSymbol}; se suspende su sondeo para evitar reintentos innecesarios.`,
          );
        }
      } else if (msg.error?.code === 'AlreadySubscribed') {
        this.logger.debug(`Deriv ya suscrito: ${msg.error?.message}`);
      } else {
        this.logger.error(`Deriv API error: ${JSON.stringify(msg.error)}`);
      }
    }

    // Resolver promesas de request/response (req_id)
    if (msg.req_id && this.pendingRequests.has(msg.req_id)) {
      const { resolve, reject, timer } = this.pendingRequests.get(msg.req_id)!;
      if (timer) clearTimeout(timer);
      this.pendingRequests.delete(msg.req_id);
      if (msg.error) {
        // Treat AlreadySubscribed as a successful outcome (idempotent)
        if (msg.error?.code === 'AlreadySubscribed') {
          this.logger.log(`Deriv: already subscribed (req_id=${msg.req_id})`);
          resolve(msg);
        } else {
          reject(msg.error);
        }
      } else resolve(msg);
    }

    // Emitir eventos internos según el tipo de mensaje (msg_type)
    switch (msg.msg_type) {
      case 'tick':
        this.events.emit('deriv.tick', msg.tick);
        break;
      case 'ohlc':
        this.events.emit('deriv.candle', msg.ohlc);
        break;
      case 'candles':
        this.events.emit('deriv.candles.history', {
          echo_req: msg.echo_req,
          candles: msg.candles,
        });
        if (msg.candles && msg.candles.length > 0 && msg.echo_req?.ticks_history) {
          const lastC = msg.candles[msg.candles.length - 1];
          this.events.emit('deriv.tick', {
            symbol: msg.echo_req.ticks_history,
            quote: Number(lastC.close),
            epoch: Number(lastC.epoch),
          });
        }
        break;
      case 'balance':
        this.events.emit('deriv.balance', msg.balance);
        break;
      case 'authorize':
        // Si la respuesta de authorize contiene error, msg.error ya fue manejado arriba.
        if (msg.authorize) {
          this.isAuthorized = true;
          this.logger.log('🔐 Autorización recibida: cuenta autorizada');
          this.events.emit('deriv.authorize', msg.authorize);
          // Tras autorizar, pedir balance y suscribirse a balance/account updates
          this.send({ balance: 1, subscribe: 1 }).catch((e) =>
            this.logger.error(`No se pudo solicitar balance: ${e}`),
          );
        } else {
          this.isAuthorized = false;
          this.logger.warn('Respuesta de autorización vacía o con error');
          this.events.emit('deriv.authorize', null);
        }
        break;
      default:
        break;
    }
  }

  /** Connect via Options OTP flow: request OTP URL and connect to it. */
  private async connectWithOtp(): Promise<void> {
    const appId = this.config.get<string>('DERIV_APP_ID', '1089');
    const token = this.config.get<string>('DERIV_API_TOKEN');
    const accountId = this.config.get<string>('DERIV_ACCOUNT_ID');

    if (!token) {
      this.logger.error('DERIV_API_TOKEN no configurado; no se puede solicitar OTP');
      return;
    }
    if (!accountId) {
      this.logger.error('DERIV_ACCOUNT_ID no configurado; se necesita para OTP');
      return;
    }

    const path = `/trading/v1/options/accounts/${encodeURIComponent(
      accountId,
    )}/otp`;

    const options: https.RequestOptions = {
      hostname: 'api.derivws.com',
      port: 443,
      path,
      method: 'POST',
      headers: {
        'Deriv-App-ID': appId,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    this.logger.log(`Solicitando OTP para account=${accountId}`);

    const url = await new Promise<string | null>((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json?.data?.url) resolve(json.data.url as string);
            else {
              reject(
                new Error(
                  `No OTP URL in response: ${JSON.stringify(json)}`,
                ),
              );
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', (e) => reject(e));
      req.write('');
      req.end();
    });

    if (!url) throw new Error('OTP URL no recibida');

    this.logger.log(`Conectando a Deriv (OTP URL): ${url}`);
    this.ws = new WebSocket(url);
    this.ws.on('open', () => this.onOpen());
    this.ws.on('message', (data) => this.onMessage(data));
    this.ws.on('close', () => this.onClose());
    this.ws.on('error', (err) => this.logger.error(`WS error: ${err.message}`));
  }

  /** Envía un mensaje y devuelve una promesa que resuelve con la respuesta (usa req_id). */
  send(payload: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket no conectado a Deriv'));
        return;
      }
      const req_id = this.reqIdCounter++;
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(req_id)) {
          this.pendingRequests.delete(req_id);
          reject(new Error('Timeout esperando respuesta de Deriv'));
        }
      }, 15_000);

      this.pendingRequests.set(req_id, { resolve, reject, timer, channel: 'primary' });
      try {
        this.ws.send(JSON.stringify({ ...payload, req_id }));
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(req_id);
        reject(err);
      }
    });
  }

  private getPublicWs(): Promise<WebSocket> {
    if (this.publicWs?.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.publicWs);
    }
    if (this.publicConnectPromise) {
      return this.publicConnectPromise;
    }

    const waitMs = this.publicReconnectBlockedUntil - Date.now();
    if (waitMs > 0) {
      return Promise.reject(new Error(`reconexión pública en ${Math.ceil(waitMs / 1000)}s`));
    }

    const url = 'wss://api.derivws.com/trading/v1/options/ws/public';
    this.logger.log(`Conectando a Deriv WS Público (Market Data 100/200): ${url}`);

    this.publicConnectPromise = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.publicWs = ws;
      let settled = false;

      ws.on('message', (data) => this.onMessage(data));
      ws.once('open', () => {
        settled = true;
        this.publicReconnectAttempts = 0;
        this.publicReconnectBlockedUntil = 0;
        this.logger.log('✅ Conexión WebSocket Pública (Crash/Boom 100/200) lista');
        resolve(ws);
      });
      ws.on('error', (err) => {
        this.logger.error(`Public WS error: ${err?.message}`);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      ws.once('close', () => {
        if (this.publicWs === ws) this.publicWs = null;

        this.publicReconnectAttempts++;
        const delay = Math.min(1000 * 2 ** this.publicReconnectAttempts, 60_000);
        this.publicReconnectBlockedUntil = Date.now() + delay;

        for (const [reqId, req] of this.pendingRequests.entries()) {
          if (req.channel !== 'public') continue;
          if (req.timer) clearTimeout(req.timer);
          req.reject(new Error('WebSocket público cerrado'));
          this.pendingRequests.delete(reqId);
        }

        if (!settled) {
          settled = true;
          reject(new Error('WebSocket público cerrado durante la conexión'));
        }
        this.logger.warn(
          `Public WS cerrado; nuevo intento permitido en ${delay / 1000}s`,
        );
      });
    }).finally(() => {
      this.publicConnectPromise = null;
    });

    return this.publicConnectPromise;
  }

  private async sendPublic(payload: any): Promise<any> {
    const ws = await this.getPublicWs();
    return new Promise((resolve, reject) => {
      const req_id = this.reqIdCounter++;
      const timer = setTimeout(() => {
        if (!this.pendingRequests.has(req_id)) return;
        this.pendingRequests.delete(req_id);
        reject(new Error('Timeout esperando respuesta del WebSocket público'));
      }, 15_000);

      this.pendingRequests.set(req_id, {
        resolve,
        reject,
        timer,
        channel: 'public',
      });
      try {
        ws.send(JSON.stringify({ ...payload, req_id }));
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(req_id);
        reject(err);
      }
    });
  }

  private async pollNonOtpCandles() {
    if (this.publicPollInFlight || Date.now() < this.publicPollBlockedUntil) return;
    this.publicPollInFlight = true;
    try {
      const requests: { symbol: string; granularity: number }[] = [];
      for (const sym of this.nonOtpSymbols) {
        if (this.unsupportedPublicSymbols.has(sym)) continue;
        requests.push({ symbol: sym, granularity: 60 }, { symbol: sym, granularity: 300 });
      }
      for (const request of requests) {
        try {
          await this.sendPublic({
            ticks_history: request.symbol,
            style: 'candles',
            granularity: request.granularity,
            count: 5,
            end: 'latest',
          });
        } catch (error: any) {
          if (error?.code === 'RateLimit') {
            this.publicPollBlockedUntil = Date.now() + 60_000;
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    } finally {
      this.publicPollInFlight = false;
    }
  }

  subscribeTicks(symbol: string) {
    if (this.subscribedTicks.has(symbol)) {
      this.logger.debug(`Ticks ya suscrito: ${symbol}`);
      return;
    }

    const isNonOtp = this.nonOtpSymbols.has(symbol.toUpperCase());
    if (isNonOtp) {
      this.subscribedTicks.add(symbol);
      this.logger.log(`Ticks para ${symbol} activos vía sondeo continuo de velas [Público]`);
      return;
    }

    this.send({ ticks: symbol, subscribe: 1 })
      .then(() => {
        this.subscribedTicks.add(symbol);
        this.logger.log(`Suscrito a ticks ${symbol}`);
      })
      .catch((e) => {
        // If already subscribed according to Deriv, mark as subscribed and don't treat as error
        if (e?.code === 'AlreadySubscribed' || (e?.error && e.error.code === 'AlreadySubscribed')) {
          this.subscribedTicks.add(symbol);
          this.logger.log(`Ya estaba suscrito a ticks ${symbol}`);
          return;
        }
        if (e?.code === 'RateLimit' || (e?.error && e.error.code === 'RateLimit')) {
          this.logger.warn(`RateLimit en ticks ${symbol}. Reintentando en 3s...`);
          setTimeout(() => this.subscribeTicks(symbol), 3000);
          return;
        }
        this.logger.error(`Error suscribiendo ticks ${symbol}: ${JSON.stringify(e)}`);
      });
  }

  subscribeCandles(symbol: string, granularitySeconds = 60) {
    const key = `${symbol}:${granularitySeconds}`;
    if (this.subscribedCandles.has(key)) {
      this.logger.debug(`Velas ya suscritas: ${key}`);
      return;
    }

    const isNonOtp = this.nonOtpSymbols.has(symbol.toUpperCase());
    const sender = isNonOtp ? (p: any) => this.sendPublic(p) : (p: any) => this.send(p);

    const macroHistoryCounts: Record<number, number> = {
      900: 5000,
      1800: 4322,
      3600: 2162,
      14400: 542,
    };
    const payload: any = {
      ticks_history: symbol,
      style: 'candles',
      granularity: granularitySeconds,
      end: 'latest',
      count: macroHistoryCounts[granularitySeconds] ?? 500,
    };
    if (!isNonOtp) {
      payload.subscribe = 1;
    }

    sender(payload)
      .then(() => {
        this.candleRetryAttempts.delete(key);
        this.subscribedCandles.add(key);
        this.logger.log(`Suscrito a velas ${key}${isNonOtp ? ' [Público Batch]' : ''}`);
      })
      .catch((e) => {
        if (e?.code === 'AlreadySubscribed' || (e?.error && e.error.code === 'AlreadySubscribed')) {
          this.subscribedCandles.add(key);
          this.logger.log(`Ya estaba suscrito a velas ${key}`);
          return;
        }
        if (e?.code === 'RateLimit' || (e?.error && e.error.code === 'RateLimit')) {
          const attempt = (this.candleRetryAttempts.get(key) ?? 0) + 1;
          this.candleRetryAttempts.set(key, attempt);
          const retryDelay = Math.min(5000 * 2 ** (attempt - 1), 60_000);
          this.logger.warn(
            `RateLimit en velas ${key}. Reintentando en ${retryDelay / 1000}s (intento ${attempt})...`,
          );
          setTimeout(() => this.subscribeCandles(symbol, granularitySeconds), retryDelay);
          return;
        }
        this.logger.error(`Error suscribiendo velas ${symbol}: ${JSON.stringify(e)}`);
      });
  }

  /** Trae velas históricas puntuales (sin suscripción) */
  getCandlesHistory(symbol: string, granularitySeconds: number, count = 500, end: string | number = 'latest') {
    return this.send({
      ticks_history: symbol,
      style: 'candles',
      granularity: granularitySeconds,
      count,
      end,
    });
  }

  getActiveSymbols() {
    // product_type field is not accepted by the API in some environments;
    // request only active_symbols to avoid InputValidationFailed errors.
    return this.send({ active_symbols: 'brief' });
  }
}
