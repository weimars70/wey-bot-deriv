import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  private readonly userCacheTtlMs = 15_000;
  private readonly userByIdCache = new Map<string, { expiresAt: number; user: User | null }>();
  private readonly userByEmailCache = new Map<string, { expiresAt: number; user: User | null }>();

  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
  ) {}

  private cacheUser(user: User | null, idHint?: string, emailHint?: string) {
    const expiresAt = Date.now() + this.userCacheTtlMs;
    if (user) {
      this.userByIdCache.set(user.id, { expiresAt, user });
      if (user.email) {
        this.userByEmailCache.set(user.email.toLowerCase(), { expiresAt, user });
      }
    } else {
      if (idHint) this.userByIdCache.set(idHint, { expiresAt, user: null });
      if (emailHint) this.userByEmailCache.set(emailHint.toLowerCase(), { expiresAt, user: null });
    }
  }

  private invalidateUserCache(userId?: string, email?: string) {
    if (userId) {
      const cached = this.userByIdCache.get(userId)?.user;
      if (cached?.email) this.userByEmailCache.delete(cached.email.toLowerCase());
      this.userByIdCache.delete(userId);
    }
    if (email) {
      this.userByEmailCache.delete(email.toLowerCase());
    }
  }

  async findByEmail(email: string) {
    const key = (email || '').trim().toLowerCase();
    const cached = this.userByEmailCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }
    const user = await this.usersRepo.findOne({ where: { email } });
    this.cacheUser(user, undefined, key);
    return user;
  }

  async findById(id: string) {
    const cached = this.userByIdCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }
    const user = await this.usersRepo.findOne({ where: { id } });
    this.cacheUser(user, id);
    return user;
  }

  async findAllPublic() {
    const users = await this.usersRepo.find({ order: { createdAt: 'DESC' } });
    return users.map((user) => this.toPublic(user));
  }

  findAllWithPhone() {
    return this.usersRepo
      .createQueryBuilder('user')
      .select(['user.countryCallingCode', 'user.phoneNumber', 'user.notificationGroup'])
      .where("NULLIF(BTRIM(user.countryCallingCode), '') IS NOT NULL")
      .andWhere("NULLIF(BTRIM(user.phoneNumber), '') IS NOT NULL")
      .getMany();
  }

  findRecipientsForH1() {
    return this.usersRepo
      .createQueryBuilder('user')
      .select(['user.email', 'user.countryCallingCode', 'user.phoneNumber', 'user.notificationGroup'])
      .where("NULLIF(BTRIM(user.email), '') IS NOT NULL")
      .andWhere("NULLIF(BTRIM(user.countryCallingCode), '') IS NOT NULL")
      .andWhere("NULLIF(BTRIM(user.phoneNumber), '') IS NOT NULL")
      .andWhere("(user.notificationGroup IS NULL OR user.notificationGroup IN ('ALL', 'H1_ONLY'))")
      .getMany();
  }

  findRecipientsForAll() {
    return this.usersRepo
      .createQueryBuilder('user')
      .select(['user.email', 'user.countryCallingCode', 'user.phoneNumber', 'user.notificationGroup'])
      .where("NULLIF(BTRIM(user.email), '') IS NOT NULL")
      .andWhere("NULLIF(BTRIM(user.countryCallingCode), '') IS NOT NULL")
      .andWhere("NULLIF(BTRIM(user.phoneNumber), '') IS NOT NULL")
      .andWhere("(user.notificationGroup IS NULL OR user.notificationGroup = 'ALL')")
      .getMany();
  }

  async create(
    email: string,
    passwordHash: string,
    name: string | undefined,
    countryCallingCode: string,
    phoneNumber: string,
  ) {
    const defaultPrefs = {
      h1NoWick: true,
      doubleWick: false,
      crashBoomIa: false,
      spikePatterns: false,
      weySignals: false,
      m5Plus: false,
      m5X: true,
    };
    const user = this.usersRepo.create({
      email,
      passwordHash,
      name,
      countryCallingCode,
      phoneNumber,
      notificationGroup: 'ALL',
      strategyPreferences: defaultPrefs,
    });
    return this.usersRepo.save(user);
  }

  async setActiveSession(userId: string, sessionId: string) {
    const now = new Date();
    await this.usersRepo.update(userId, {
      activeSessionId: sessionId,
      lastActiveAt: now,
    });
    const cached = this.userByIdCache.get(userId)?.user;
    if (cached) {
      cached.activeSessionId = sessionId;
      cached.lastActiveAt = now;
      this.cacheUser(cached);
    } else {
      this.invalidateUserCache(userId);
    }
  }

  async clearActiveSession(userId: string) {
    await this.usersRepo.update(userId, {
      activeSessionId: null,
      lastActiveAt: null,
    });
    this.invalidateUserCache(userId);
  }

  async updateHeartbeat(userId: string) {
    const now = new Date();
    await this.usersRepo.update(userId, {
      lastActiveAt: now,
    });
    const cached = this.userByIdCache.get(userId)?.user;
    if (cached) {
      cached.lastActiveAt = now;
      this.cacheUser(cached);
    }
  }

  async updatePhone(
    userId: string,
    countryCallingCode: string,
    phoneNumber: string,
  ) {
    await this.usersRepo.update(userId, {
      countryCallingCode,
      phoneNumber,
    });
    this.invalidateUserCache(userId);
    return this.findById(userId);
  }

  async updatePublicProfile(userId: string, dto: UpdateUserDto) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const normalizedEmail = dto.email.trim().toLowerCase();
    const emailOwner = await this.findByEmail(normalizedEmail);
    if (emailOwner && emailOwner.id !== userId) {
      throw new ConflictException('Ya existe una cuenta con ese email');
    }

    const oldEmail = user.email;
    user.name = dto.name.trim();
    user.email = normalizedEmail;
    user.countryCallingCode = dto.countryCallingCode;
    user.phoneNumber = dto.phoneNumber;
    if (dto.notificationGroup) {
      user.notificationGroup = dto.notificationGroup;
    }

    const updated = await this.usersRepo.save(user);
    this.invalidateUserCache(userId, oldEmail);
    this.cacheUser(updated);
    return this.toPublic(updated);
  }

  async updatePreferences(userId: string, preferences: any) {
    await this.usersRepo.update(userId, {
      strategyPreferences: preferences,
    });
    this.invalidateUserCache(userId);
    return { success: true, strategyPreferences: preferences };
  }

  // Nunca exponer passwordHash en las respuestas de la API
  toPublic(user: User) {
    const { passwordHash, ...rest } = user;
    rest.notificationGroup = user.notificationGroup || 'ALL';
    if (!rest.strategyPreferences) {
      rest.strategyPreferences = {
        h1NoWick: true,
        doubleWick: false,
        crashBoomIa: false,
        spikePatterns: false,
        weySignals: false,
        m5Plus: false,
        m5X: true,
      };
    }
    // Garantizar que m5Plus exista en preferencias antiguas que no lo tenían
    if (rest.strategyPreferences.m5Plus === undefined) {
      rest.strategyPreferences.m5Plus = false;
    }
    if (rest.strategyPreferences.m5X === undefined) {
      rest.strategyPreferences.m5X = true;
    }
    return rest;
  }
}
