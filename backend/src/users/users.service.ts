import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
  ) {}

  findByEmail(email: string) {
    return this.usersRepo.findOne({ where: { email } });
  }

  findById(id: string) {
    return this.usersRepo.findOne({ where: { id } });
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
      .select(['user.countryCallingCode', 'user.phoneNumber', 'user.notificationGroup'])
      .where("NULLIF(BTRIM(user.countryCallingCode), '') IS NOT NULL")
      .andWhere("NULLIF(BTRIM(user.phoneNumber), '') IS NOT NULL")
      .andWhere("(user.notificationGroup IS NULL OR user.notificationGroup IN ('ALL', 'H1_ONLY'))")
      .getMany();
  }

  findRecipientsForAll() {
    return this.usersRepo
      .createQueryBuilder('user')
      .select(['user.countryCallingCode', 'user.phoneNumber', 'user.notificationGroup'])
      .where("NULLIF(BTRIM(user.countryCallingCode), '') IS NOT NULL")
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
    await this.usersRepo.update(userId, {
      activeSessionId: sessionId,
      lastActiveAt: new Date(),
    });
  }

  async clearActiveSession(userId: string) {
    await this.usersRepo.update(userId, {
      activeSessionId: null,
      lastActiveAt: null,
    });
  }

  async updateHeartbeat(userId: string) {
    await this.usersRepo.update(userId, {
      lastActiveAt: new Date(),
    });
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

    user.name = dto.name.trim();
    user.email = normalizedEmail;
    user.countryCallingCode = dto.countryCallingCode;
    user.phoneNumber = dto.phoneNumber;
    if (dto.notificationGroup) {
      user.notificationGroup = dto.notificationGroup;
    }

    const updated = await this.usersRepo.save(user);
    return this.toPublic(updated);
  }

  async updatePreferences(userId: string, preferences: any) {
    await this.usersRepo.update(userId, {
      strategyPreferences: preferences,
    });
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
