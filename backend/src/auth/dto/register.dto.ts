import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  password: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsString()
  @Matches(/^\+[1-9]\d{0,3}$/, {
    message: 'El indicativo debe tener formato internacional, por ejemplo +57',
  })
  countryCallingCode: string;

  @IsString()
  @Matches(/^\d{7,14}$/, {
    message: 'El número debe contener entre 7 y 14 dígitos, sin espacios',
  })
  phoneNumber: string;
}
