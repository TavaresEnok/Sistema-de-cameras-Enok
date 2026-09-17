import { IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

export const PTZ_DIRECTIONS = ['Up', 'Down', 'Left', 'Right', 'ZoomIn', 'ZoomOut'] as const;
export const PTZ_ACTIONS = ['start', 'stop', 'step', 'home'] as const;

export class PtzCommandDto {
  @IsString()
  @IsIn(PTZ_ACTIONS)
  action!: (typeof PTZ_ACTIONS)[number];

  @IsOptional()
  @ValidateIf((object: PtzCommandDto) => object.action === 'start' || object.action === 'stop' || object.action === 'step')
  @IsString()
  @IsIn(PTZ_DIRECTIONS)
  direction?: (typeof PTZ_DIRECTIONS)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  speed?: number;

  /** Deslocamento aproximado de um toque. A velocidade é fixa no servidor. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  angleDegrees?: number;

  @IsOptional()
  @IsInt()
  @Min(120)
  @Max(2500)
  durationMs?: number;
}
