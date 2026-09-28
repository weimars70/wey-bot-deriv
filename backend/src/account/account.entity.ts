import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('account_snapshots')
export class AccountSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  loginid: string;

  @Column('double precision')
  balance: number;

  @Column()
  currency: string;

  @Column({ nullable: true })
  email: string;

  @Column({ default: false })
  isVirtual: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
