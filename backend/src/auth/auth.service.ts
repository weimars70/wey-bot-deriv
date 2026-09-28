import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { randomUUID } from 'crypto';

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.usersService.findByEmail(normalizedEmail);
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con ese email');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.usersService.create(
      normalizedEmail,
      passwordHash,
      dto.name?.trim() || undefined,
      dto.countryCallingCode,
      dto.phoneNumber,
    );

    return this.buildSession(user.id, user.email);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Actualizar timestamp de última actividad
    const sessionId = user.activeSessionId || randomUUID();
    await this.usersService.setActiveSession(user.id, sessionId);

    return this.buildSession(user.id, user.email, sessionId);
  }

  async logout(userId: string) {
    await this.usersService.clearActiveSession(userId);
    return { ok: true };
  }

  async heartbeat(userId: string) {
    await this.usersService.updateHeartbeat(userId);
    return { ok: true };
  }

  private async buildSession(userId: string, email: string, sessionId?: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new Error('Usuario no encontrado');
    const sid = sessionId || user.activeSessionId || randomUUID();
    if (!user.activeSessionId) {
      await this.usersService.setActiveSession(user.id, sid);
    }
    const accessToken = this.jwtService.sign({ sub: userId, email, sid });
    return {
      accessToken,
      user: this.usersService.toPublic(user),
    };
  }
}
