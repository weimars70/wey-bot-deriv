import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { Candle } from './candle.entity';

@Injectable()
export class CandlesService {
  private readonly logger = new Logger(CandlesService.name);

  constructor(
    @InjectRepository(Candle)
    private readonly candlesRepo: Repository<Candle>,
  ) {}

  private readonly ohlcBuffer = new Map<string, any>();
  private flushTimer: NodeJS.Timeout | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  private macroSyncTimer: NodeJS.Timeout | null = null;

  onModuleInit() {
    this.flushTimer = setInterval(() => this.flushOhlcBuffer(), 2000);
    // Sincronización continua de velas macro (M15, M30, H1, H4) a partir de las velas M1 en vivo
    this.macroSyncTimer = setInterval(() => this.syncAllMacroCandlesFromM1(), 30000);
    setTimeout(() => this.syncAllMacroCandlesFromM1(), 5000);
  }

  onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.macroSyncTimer) clearInterval(this.macroSyncTimer);
  }

  // Actualización de la vela "en curso" que Deriv manda en vivo (msg_type: ohlc)
  // Se acumula en un Map en memoria y se guarda en batch cada 2 segundos para no saturar PostgreSQL.
  @OnEvent('deriv.candle')
  handleOhlcUpdate(ohlc: any) {
    if (!ohlc?.symbol || !ohlc?.granularity) return;
    const g = Number(ohlc.granularity) || 60;
    const rawEpoch = Number(ohlc.epoch);
    const bucketEpoch = Math.floor(rawEpoch / g) * g;
    const key = `${ohlc.symbol}:${g}:${bucketEpoch}`;

    this.ohlcBuffer.set(key, {
      symbol: ohlc.symbol,
      granularity: g,
      epoch: bucketEpoch,
      open: Number(ohlc.open),
      high: Number(ohlc.high),
      low: Number(ohlc.low),
      close: Number(ohlc.close),
    });
  }

  private async flushOhlcBuffer() {
    if (this.ohlcBuffer.size === 0) return;
    const records = Array.from(this.ohlcBuffer.values());
    this.ohlcBuffer.clear();
    try {
      await this.enqueueUpsert(records, 'batch ohlc');
    } catch (e) {
      // No sobrescribir una actualizacion mas reciente que haya llegado durante el guardado.
      for (const record of records) {
        const key = this.candleKey(record);
        if (!this.ohlcBuffer.has(key)) this.ohlcBuffer.set(key, record);
      }
      this.logger.error(`Error guardando batch ohlc: ${e}`);
    }
  }

  // Historial inicial que llega al suscribirse (msg_type: candles)
  @OnEvent('deriv.candles.history')
  async handleHistory(payload: { echo_req: any; candles: any[] }) {
    const { echo_req, candles } = payload;
    if (!candles?.length) return;
    try {
      const symbol = echo_req.ticks_history;
      const g = Number(echo_req.granularity) || 60;
      const records = candles.map((c) => {
        const rawEpoch = Number(c.epoch);
        const bucketEpoch = Math.floor(rawEpoch / g) * g;
        return {
          symbol,
          granularity: g,
          epoch: bucketEpoch,
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
        };
      });

      await this.enqueueUpsert(records, `historial ${symbol} (${g}s)`);
      this.logger.log(
        `Historial de ${candles.length} velas guardado en batch para ${symbol} (${g}s)`,
      );
    } catch (e) {
      this.logger.error(`Error guardando historial de velas: ${e}`);
    }
  }

  /**
   * Sincroniza periódicamente las velas de marcos mayores (M15, M30, H1, H4)
   * a partir del flujo continuo de velas M1 en la base de datos.
   */
  async syncAllMacroCandlesFromM1(): Promise<void> {
    try {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const activeSymbolsRows: { symbol: string }[] = await this.candlesRepo.query(
        'SELECT DISTINCT symbol FROM candles WHERE granularity = 60 AND epoch >= $1',
        [nowEpoch - 86400],
      );
      const symbols = activeSymbolsRows.map((r) => r.symbol);
      if (!symbols.length) return;

      const macroGranularities = [900, 1800, 3600, 14400];
      for (const symbol of symbols) {
        for (const g of macroGranularities) {
          await this.syncMacroCandlesForSymbol(symbol, g);
        }
      }
    } catch (e: any) {
      this.logger.error(`Error en sincronización macro periódica: ${e?.message || e}`);
    }
  }

  async syncMacroCandlesForSymbol(symbol: string, granularity: number): Promise<void> {
    try {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const maxRes = await this.candlesRepo.query(
        'SELECT max(epoch) as max_epoch FROM candles WHERE symbol = $1 AND granularity = $2',
        [symbol, granularity],
      );
      const maxEpoch = Number(maxRes[0]?.max_epoch);
      if (maxEpoch && maxEpoch >= nowEpoch - 60) return;

      const fromEpoch = maxEpoch ? maxEpoch : nowEpoch - 172800;
      const synCandles = await this.synthesizeFromM1(symbol, granularity, fromEpoch);
      if (synCandles.length > 0) {
        await this.enqueueUpsert(synCandles, `sync macro ${symbol}@${granularity}s`);
      }
    } catch (e: any) {
      this.logger.warn(`Error sincronizando ${symbol}@${granularity}s: ${e?.message || e}`);
    }
  }

  async synthesizeFromM1(
    symbol: string,
    granularity: number,
    fromEpoch: number,
  ): Promise<Partial<Candle>[]> {
    const rows: any[] = await this.candlesRepo.query(
      `SELECT
        floor(epoch / $1) * $1 as epoch,
        min(low) as low,
        max(high) as high,
        (array_agg(open ORDER BY epoch ASC))[1] as open,
        (array_agg(close ORDER BY epoch DESC))[1] as close
       FROM candles
       WHERE symbol = $2 AND granularity = 60 AND epoch >= $3
       GROUP BY floor(epoch / $1) * $1
       ORDER BY epoch ASC`,
      [granularity, symbol, fromEpoch],
    );

    return rows.map((r) => ({
      symbol,
      granularity,
      epoch: Number(r.epoch),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
    }));
  }

  async findLatest(symbol: string, granularity = 60, limit = 200): Promise<Candle[]> {
    const candles = await this.candlesRepo.find({
      where: { symbol, granularity },
      order: { epoch: 'DESC' },
      take: limit,
    });

    if (granularity <= 60 || candles.length === 0) {
      return candles;
    }

    const newestEpoch = Number(candles[0].epoch);
    const nowEpoch = Math.floor(Date.now() / 1000);
    const currentBucket = Math.floor(nowEpoch / granularity) * granularity;
    if (newestEpoch < currentBucket) {
      try {
        const syn = await this.synthesizeFromM1(symbol, granularity, newestEpoch);
        if (syn.length > 0) {
          this.enqueueUpsert(syn, `live syn ${symbol}@${granularity}s`).catch(() => {});
          const map = new Map<number, any>();
          for (const c of candles) map.set(Number(c.epoch), c);
          for (const sc of syn) map.set(Number(sc.epoch), sc);
          const merged = Array.from(map.values()).sort((a, b) => Number(b.epoch) - Number(a.epoch));
          return merged.slice(0, limit) as Candle[];
        }
      } catch (e: any) {
        this.logger.warn(`Error en merge en vivo ${symbol}@${granularity}s: ${e?.message || e}`);
      }
    }

    return candles;
  }

  private enqueueUpsert(records: any[], context: string): Promise<void> {
    if (!records.length) return Promise.resolve();

    const sortedRecords = [...records].sort((a, b) =>
      String(a.symbol).localeCompare(String(b.symbol)) ||
      Number(a.granularity) - Number(b.granularity) ||
      Number(a.epoch) - Number(b.epoch),
    );

    const operation = this.writeQueue.then(() =>
      this.upsertWithDeadlockRetry(sortedRecords, context),
    );

    // Mantener viva la cola aunque una operacion falle; el caller recibe el error real.
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  private async upsertWithDeadlockRetry(records: any[], context: string): Promise<void> {
    const maxAttempts = 4;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.candlesRepo.upsert(records, ['symbol', 'granularity', 'epoch']);
        return;
      } catch (error: any) {
        const isDeadlock =
          error?.code === '40P01' ||
          error?.driverError?.code === '40P01' ||
          String(error?.message || '').toLowerCase().includes('deadlock detected');

        if (!isDeadlock || attempt === maxAttempts) throw error;

        const delayMs = (100 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 75);
        this.logger.warn(
          `Deadlock guardando ${context}; reintento ${attempt}/${maxAttempts - 1} en ${delayMs} ms.`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  private candleKey(record: any): string {
    return `${record.symbol}:${record.granularity}:${record.epoch}`;
  }

  /** Retorna todos los pares (symbol, granularity) con datos en la BD */
  async getAvailableSymbolGranularities(): Promise<{ symbol: string; granularity: number }[]> {
    // getRawMany() in TypeORM/PostgreSQL prefixes columns with the QB alias
    // (e.g. 'c_symbol'). Using a plain SQL query avoids the naming ambiguity.
    const rows: { symbol: string; granularity: string }[] = await this.candlesRepo.query(
      'SELECT DISTINCT symbol, granularity FROM candles ORDER BY symbol, granularity',
    );
    return rows.map((r) => ({ symbol: r.symbol, granularity: Number(r.granularity) }));
  }
}
