import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { UsersService } from '../users/users.service';
import { UpdatePhoneDto } from './dto/update-phone.dto';

const PHONE_EDITOR_EMAIL = 'weimarsuber@gmail.com';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  // POST /api/auth/register { email, password, name?, countryCallingCode, phoneNumber }
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // POST /api/auth/login { email, password, forceLogoutOthers? }
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // POST /api/auth/logout -> libera la sesión activa del dispositivo
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@CurrentUser() user: { userId: string; email: string }) {
    return this.authService.logout(user.userId);
  }

  // POST /api/auth/heartbeat -> actualiza lastActiveAt para mantener la sesión viva
  @UseGuards(JwtAuthGuard)
  @Post('heartbeat')
  async heartbeat(@CurrentUser() user: { userId: string; email: string }) {
    return this.authService.heartbeat(user.userId);
  }

  // GET /api/auth/me -> requiere Authorization: Bearer <token>
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: { userId: string; email: string }) {
    const fullUser = await this.usersService.findById(user.userId);
    if (!fullUser) throw new NotFoundException('Usuario no encontrado');
    return this.usersService.toPublic(fullUser);
  }

  @UseGuards(JwtAuthGuard)
  @Put('phone')
  async updatePhone(
    @CurrentUser() sessionUser: { userId: string; email: string },
    @Body() dto: UpdatePhoneDto,
  ) {
    const fullUser = await this.usersService.findById(sessionUser.userId);
    if (!fullUser) throw new NotFoundException('Usuario no encontrado');
    if (fullUser.email.trim().toLowerCase() !== PHONE_EDITOR_EMAIL) {
      throw new ForbiddenException('Este usuario no puede editar el telefono');
    }

    const updated = await this.usersService.updatePhone(
      fullUser.id,
      dto.countryCallingCode,
      dto.phoneNumber,
    );
    if (!updated) throw new NotFoundException('Usuario no encontrado');
    return this.usersService.toPublic(updated);
  }

  // GET /api/auth/preferences -> retorna las estrategias parametrizadas del usuario
  @UseGuards(JwtAuthGuard)
  @Get('preferences')
  async getPreferences(@CurrentUser() user: { userId: string; email: string }) {
    const fullUser = await this.usersService.findById(user.userId);
    if (!fullUser) throw new NotFoundException('Usuario no encontrado');
    return this.usersService.toPublic(fullUser).strategyPreferences;
  }

  // PUT /api/auth/preferences -> actualiza las estrategias parametrizadas del usuario
  @UseGuards(JwtAuthGuard)
  @Put('preferences')
  async updatePreferences(
    @CurrentUser() user: { userId: string; email: string },
    @Body() preferences: any,
  ) {
    return this.usersService.updatePreferences(user.userId, preferences);
  }
}
