import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('watched_entry_levels')
export class WatchedEntryLevel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 30 })
  symbol: string;

  @Column('varchar', { length: 10 })
  direction: 'BUY' | 'SELL';

  @Column('float')
  entryPrice: number;

  @Column('float')
  lot: number;

  @Column('boolean', { default: false })
  multipleReactions: boolean;

  @Column('boolean', { default: false })
  backtesting: boolean;

  @Column('varchar', { length: 20, default: 'PENDING' })
  status: 'PENDING' | 'EVALUATING' | 'EXECUTING' | 'EXECUTED' | 'CANCELLED';

  @Column('varchar', { length: 255, nullable: true })
  note: string | null;

  @Column('varchar', { length: 255, nullable: true })
  evaluationReason: string | null;

  @Column('bigint', { nullable: true })
  executedAt: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
