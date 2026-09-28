import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('candles')
@Index(['symbol', 'granularity', 'epoch'], { unique: true })
export class Candle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  symbol: string;

  // granularidad en segundos (60 = 1min, 300 = 5min, etc.)
  @Column('int')
  granularity: number;

  @Column('bigint')
  epoch: number;

  @Column('double precision')
  open: number;

  @Column('double precision')
  high: number;

  @Column('double precision')
  low: number;

  @Column('double precision')
  close: number;

  @CreateDateColumn()
  createdAt: Date;
}
