import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { type AuthUser } from '../common/types/auth-user.type';
import { RondasService } from './rondas.service';

/** Rondas do mural: rodízio de mosaicos, cada parada com seu tempo. */
@Controller('rondas')
@UseGuards(JwtAuthGuard)
export class RondasController {
  constructor(private readonly rondas: RondasService) {}

  /** "Minhas rondas": as que eu posso rodar. */
  @Get()
  async listar(@CurrentUser() user: AuthUser) {
    return { items: await this.rondas.listar(user) };
  }

  /** "Rondas": a tela de administração. O serviço recusa quem não é admin. */
  @Get('administradas')
  async listarAdmin(@CurrentUser() user: AuthUser) {
    return { items: await this.rondas.listarAdmin(user) };
  }

  @Post()
  async criar(@CurrentUser() user: AuthUser, @Body() dto: { name?: string; paradas?: unknown; active?: boolean; showOnMobile?: boolean; destinatarios?: unknown }) {
    return this.rondas.criar(user, dto);
  }

  @Patch(':id')
  async atualizar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { name?: string; paradas?: unknown; active?: boolean; showOnMobile?: boolean; destinatarios?: unknown },
  ) {
    return this.rondas.atualizar(user, id, dto);
  }

  @Delete(':id')
  async remover(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rondas.remover(user, id);
  }
}
