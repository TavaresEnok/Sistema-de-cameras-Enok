import { Type } from 'class-transformer';
import { DestinatariosDto } from './destinatarios.dto';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';

export class UpdateLiveLayoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[1-8]x[1-8]$/)
  gridSize?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  cameraIds?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  showOnMobile?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => DestinatariosDto)
  destinatarios?: DestinatariosDto;
}
