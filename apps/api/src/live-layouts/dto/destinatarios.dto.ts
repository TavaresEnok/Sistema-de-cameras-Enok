import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';
import { MAX_DESTINATARIOS } from '../helpers/compartilhamento.helper';

/** Para quem o mosaico (ou a ronda) foi entregue. */
export class DestinatariosDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DESTINATARIOS)
  @IsString({ each: true })
  usuarios?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DESTINATARIOS)
  @IsString({ each: true })
  grupos?: string[];
}
