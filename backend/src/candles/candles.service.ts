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

  onModuleInit() {
    this.flushTimer = setInterval(() => this.flushOhlcBuffer(), 2000);
  }

  onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
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

  findLatest(symbol: string, granularity = 60, limit = 200) {
    return this.candlesRepo.find({
      where: { symbol, granularity },
      order: { epoch: 'DESC' },
      take: limit,
    });
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
