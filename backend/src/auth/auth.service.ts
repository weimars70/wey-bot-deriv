import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
    private readonly eventEmitter: EventEmitter2,
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

    const sessionId = randomUUID();
    await this.usersService.setActiveSession(user.id, sessionId);

    return this.buildSession(user.id, user.email, sessionId);
  }

  async login(dto: LoginDto) {
    const normalizedEmail = (dto.email || '').trim().toLowerCase();
    const user = await this.usersService.findByEmail(normalizedEmail);
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // ── VALIDACIÓN DE SESIÓN ÚNICA POR DISPOSITIVO ──
    // Se considera sesión activa en otro dispositivo si existe activeSessionId
    // y ha registrado actividad en los últimos 5 minutos.
    const SESSION_ACTIVE_WINDOW_MS = 5 * 60 * 1000;
    const isSessionActive = Boolean(
      user.activeSessionId &&
      user.lastActiveAt &&
      (Date.now() - new Date(user.lastActiveAt).getTime() < SESSION_ACTIVE_WINDOW_MS),
    );

    const isForce = dto.forceLogoutOthers === true;

    if (isSessionActive && !isForce) {
      this.logger.warn(`Intento de login con sesión activa en otro dispositivo: ${user.email}`);
      throw new ConflictException({
        statusCode: 409,
        error: 'ACTIVE_SESSION_EXISTS',
        message: 'Ya hay una sesión iniciada en otro dispositivo.',
        lastActiveAt: user.lastActiveAt,
      });
    }

    // Generar un nuevo sessionId único para este dispositivo
    const sessionId = randomUUID();
    await this.usersService.setActiveSession(user.id, sessionId);

    // Si había una sesión previa, revocarla en tiempo real en los demás dispositivos
    if (user.activeSessionId || isSessionActive) {
      this.logger.log(`Sesión previa revocada para ${user.email}. Nueva sesión: ${sessionId}`);
      this.eventEmitter.emit('auth.session_revoked', {
        userId: user.id,
        newSessionId: sessionId,
      });
    }

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
    if (user.activeSessionId !== sid) {
      await this.usersService.setActiveSession(user.id, sid);
    }
    const accessToken = this.jwtService.sign({ sub: userId, email, sid });
    return {
      accessToken,
      user: this.usersService.toPublic(user),
    };
  }
}
