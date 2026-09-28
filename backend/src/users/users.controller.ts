import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

const ADMIN_EMAIL = 'weimarsuber@gmail.com';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async findAll(@CurrentUser() sessionUser: { userId: string }) {
    await this.requireAdmin(sessionUser.userId);
    return this.usersService.findAllPublic();
  }

  @Put('me')
  async updateMe(
    @CurrentUser() sessionUser: { userId: string },
    @Body() dto: UpdateUserDto,
  ) {
    const currentUser = await this.getUser(sessionUser.userId);
    const nextEmail = dto.email.trim().toLowerCase();
    const currentEmail = currentUser.email.trim().toLowerCase();
    if (currentEmail !== ADMIN_EMAIL && nextEmail === ADMIN_EMAIL) {
      throw new ForbiddenException('El correo administrador esta reservado');
    }

    return this.usersService.updatePublicProfile(currentUser.id, dto);
  }

  @Put(':id')
  async updateUser(
    @CurrentUser() sessionUser: { userId: string },
    @Param('id') targetUserId: string,
    @Body() dto: UpdateUserDto,
  ) {
    await this.requireAdmin(sessionUser.userId);
    const targetUser = await this.getUser(targetUserId);
    const nextEmail = dto.email.trim().toLowerCase();
    if (targetUser.email.trim().toLowerCase() === ADMIN_EMAIL && nextEmail !== ADMIN_EMAIL) {
      throw new ForbiddenException('No se puede cambiar el correo administrador');
    }

    return this.usersService.updatePublicProfile(targetUser.id, dto);
  }

  private async requireAdmin(userId: string) {
    const user = await this.getUser(userId);
    if (user.email.trim().toLowerCase() !== ADMIN_EMAIL) {
      throw new ForbiddenException('Acceso exclusivo para el administrador');
    }
    return user;
  }

  private async getUser(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }
}
