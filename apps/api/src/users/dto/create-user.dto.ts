import { UserRole } from '@prisma/client';
import { CameraPermissionLevel } from '@prisma/client';
import { IsArray, IsEmail, IsEnum, IsOptional, IsString, Matches, MinLength, ValidateIf } from 'class-validator';

export class CreateUserDto {
  @IsString()
  name!: string;

  @IsString()
  @Matches(/^[a-zA-Z0-9@._+-]{3,254}$/, { message: 'Usuário deve ter 3 a 254 caracteres: letras, números, ponto, hífen, sublinhado ou e-mail.' })
  username!: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsEmail()
  email?: string;

  // Sem política de senha forte (por escolha do operador). Piso mínimo só para
  // evitar senha vazia/acidental.
  @IsString()
  @MinLength(4)
  password!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  groupIds?: string[];

  @IsOptional()
  @IsEnum(CameraPermissionLevel)
  permissionLevel?: CameraPermissionLevel;
}
