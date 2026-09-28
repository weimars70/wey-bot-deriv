import { IsString, Matches } from 'class-validator';

export class UpdatePhoneDto {
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
}
