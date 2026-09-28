import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @Matches(/^\+[1-9]\d{0,3}$/, {
    message: 'El indicativo debe tener formato internacional, por ejemplo +57',
  })
  countryCallingCode: string;

  @IsString()
  @Matches(/^\d{7,14}$/, {
    message: 'El numero debe contener entre 7 y 14 digitos, sin espacios',
  })
  phoneNumber: string;

  @IsOptional()
  @IsIn(['ALL', 'H1_ONLY'], {
    message: 'El grupo de notificación debe ser ALL o H1_ONLY',
  })
  notificationGroup?: 'ALL' | 'H1_ONLY';
}
