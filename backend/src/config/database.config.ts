import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Tick } from '../ticks/tick.entity';
import { Candle } from '../candles/candle.entity';
import { AccountSnapshot } from '../account/account.entity';
import { User } from '../users/user.entity';
import { TradeRecord } from '../trading/trade.entity';
import { WatchedEntryLevel } from '../watched-levels/watched-level.entity';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'deriv_user',
    password: process.env.DB_PASSWORD || 'deriv_pass',
    database: process.env.DB_DATABASE || 'deriv_db',
    entities: [Tick, Candle, AccountSnapshot, User, TradeRecord, WatchedEntryLevel],
    // Tablas y columnas ya sincronizadas en BD; false evita conflictos de schema y bloqueos
    synchronize: false,
    logging: false,
    extra: {
      max: 10,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    },
  }),
);
