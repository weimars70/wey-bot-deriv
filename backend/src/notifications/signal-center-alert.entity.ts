import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('signal_center_alerts')
@Index(['dedupeKey'], { unique: true })
export class SignalCenterAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 60 })
  type: string;

  @Column('varchar', { length: 30, nullable: true })
  symbol: string | null;

  @Column('varchar', { length: 180 })
  title: string;

  @Column('text')
  message: string;

  @Column('text', { nullable: true })
  speechText: string | null;

  @Column('varchar', { length: 100, default: '/dashboard' })
  targetPath: string;

  @Column('jsonb', { nullable: true })
  routeQuery: Record<string, unknown> | null;

  @Column('varchar', { length: 20, default: 'warning' })
  severity: string;

  @Column('varchar', { length: 255, unique: true })
  dedupeKey: string;

  @CreateDateColumn()
  createdAt: Date;
}
