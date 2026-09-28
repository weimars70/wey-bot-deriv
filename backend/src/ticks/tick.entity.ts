import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('ticks')
@Index(['symbol', 'epoch'])
export class Tick {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  symbol: string;

  @Column('double precision')
  quote: number;

  @Column('bigint')
  epoch: number; // timestamp Unix que envía Deriv

  @Column({ nullable: true })
  pipSize: number;

  @CreateDateColumn()
  createdAt: Date;
}
