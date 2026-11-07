import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        config.get<string>('JWT_SECRET') ||
        process.env.JWT_SECRET ||
        'dev-secret-cambiar-en-produccion',
    });
  }

  // El resultado de validate() se inyecta como request.user
  async validate(payload: { sub: string; email: string; sid?: string }) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Usuario no válido');
    }

    // ── CANDADO DE SESIÓN ÚNICA POR DISPOSITIVO ──
    // Si el usuario tiene una sesión activa registrada en el sistema,
    // el token debe pertenecer estrictamente a esa sesión activa.
    // Si el sid no coincide, significa que se inició sesión en otro dispositivo.
    if (user.activeSessionId && (!payload.sid || payload.sid !== user.activeSessionId)) {
      throw new UnauthorizedException(
        'Tu sesión ha sido cerrada porque se inició sesión en otro dispositivo.',
      );
    }

    return { userId: payload.sub, email: payload.email, sid: payload.sid };
  }
}
