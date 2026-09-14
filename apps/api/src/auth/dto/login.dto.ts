import { IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  /** `email` permanece aceito por compatibilidade com versões já instaladas. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  email?: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
