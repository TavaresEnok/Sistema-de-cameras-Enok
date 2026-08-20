import { IsIP, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Campos que o proprietário pode alterar pelo aplicativo móvel. */
export class UpdateMyCameraDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @IsIP()
  ip?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  rtspPort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  rtspPath?: string;
}
