import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('trades')
export class TradeRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 30 })
  strategy: 'H1_NO_WICK' | 'CRASH_BOOM_IA' | 'DOUBLE_WICK_MECHA' | 'DASHBOARD_STARS' | 'MANUAL_APP' | 'M5_PLUS' | 'M5_X' | 'WATCHED_LEVEL' | 'WATCHED_LEVEL_BT';

  @Column('boolean', { default: false })
  backtesting: boolean;

  @Column('varchar', { length: 20 })
  symbol: string;

  @Column('varchar', { length: 30, nullable: true })
  mercado: string;

  @Column('varchar', { length: 10 })
  direction: 'BUY' | 'SELL';

  @Column('float')
  entryPrice: number;

  @Column('float', { default: 0 })
  currentPrice: number;

  @Column('float', { nullable: true })
  stopLossPrice: number | null;

  @Column('float', { nullable: true })
  takeProfitPrice: number | null;

  @Column('bigint')
  entryTime: number; // Unix epoch seconds

  @Column('bigint', { nullable: true })
  targetTime: number | null; // Unix epoch seconds (ej: :00 de la siguiente hora para H1)

  @Column('varchar', { length: 20, default: 'OPEN' })
  status: 'OPEN' | 'CLOSED';

  @Column('float', { default: 0 })
  pnlPoints: number;

  @Column('float', { default: 0 })
  maxProfitPoints: number;

  @Column('float', { default: 0 })
  maxProfitUsd: number;

  @Column('boolean', { default: false })
  hadSpike: boolean;

  @Column('integer', { default: 0 })
  spikeCount: number;

  @Column('float', { default: 0 })
  pnlPercent: number;

  @Column('float', { nullable: true })
  exitPrice: number | null;

  @Column('bigint', { nullable: true })
  exitTime: number | null;

  @Column('varchar', { length: 50, nullable: true })
  exitReason: string | null;

  @Column('varchar', { length: 50, nullable: true })
  mt5Ticket: string | null;

  @Column('float', { default: 0 })
  pnlUsd: number;

  @Column('float', { nullable: true, default: 0.5 })
  lot: number | null;

  @Column('integer', { nullable: true })
  durationSec: number | null;

  @Column('integer', { nullable: true })
  hourOfDay: number | null; // 0..23 hora local

  @Column('integer', { nullable: true })
  dayOfWeek: number | null; // 0..6 (0 = domingo)

  @Column('varchar', { length: 20, nullable: true })
  session: 'MADRUGADA' | 'MANANA' | 'TARDE' | 'NOCHE' | null;

  @Column('varchar', { length: 15, nullable: true })
  result: 'WIN' | 'LOSS' | 'BREAKEVEN' | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
