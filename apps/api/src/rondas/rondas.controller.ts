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

  @Get()
  async listar(@CurrentUser() user: AuthUser) {
    return { items: await this.rondas.listar(user) };
  }

  @Post()
  async criar(@CurrentUser() user: AuthUser, @Body() dto: { name?: string; paradas?: unknown }) {
    return this.rondas.criar(user, dto);
  }

  @Patch(':id')
  async atualizar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { name?: string; paradas?: unknown },
  ) {
    return this.rondas.atualizar(user, id, dto);
  }

  @Delete(':id')
  async remover(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rondas.remover(user, id);
  }
}
