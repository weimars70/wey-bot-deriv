import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('users')
@Unique(['email'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  email: string;

  // Nunca se devuelve en respuestas (ver UsersService.toPublic)
  @Column()
  passwordHash: string;

  @Column({ type: 'varchar', nullable: true })
  name: string;

  // Anulables para conservar las cuentas creadas antes de solicitar teléfono.
  @Column({ type: 'varchar', length: 5, nullable: true })
  countryCallingCode: string | null;

  @Column({ type: 'varchar', length: 14, nullable: true })
  phoneNumber: string | null;

  @Column({ type: 'varchar', length: 20, default: 'ALL', nullable: true })
  notificationGroup: 'ALL' | 'H1_ONLY';

  @Column({ type: 'varchar', nullable: true })
  activeSessionId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastActiveAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  strategyPreferences: {
    h1NoWick?: boolean;
    doubleWick?: boolean;
    crashBoomIa?: boolean;
    spikePatterns?: boolean;
    weySignals?: boolean;
    m5Plus?: boolean;
    m5X?: boolean;
  } | null;

  @CreateDateColumn()
  createdAt: Date;
}
