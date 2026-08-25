import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { type AuthUser } from '../common/types/auth-user.type';
import { duracaoDaVolta, validarParadas, type ParadaDaRonda } from './helpers/ronda.helper';

/**
 * RONDAS: rodízio de mosaicos no mural.
 *
 * A ronda é DE QUEM A CRIOU, como os mosaicos do /live já são. Cada operador
 * monta a volta que faz sentido para o turno dele — o da portaria não é o do
 * estacionamento — e ninguém mexe na do outro.
 */
@Injectable()
export class RondasService {
  constructor(private readonly prisma: PrismaService) {}

  /** Os mosaicos que ESTE usuário pode usar numa ronda. */
  private async layoutsDoUsuario(userId: string): Promise<Set<string>> {
    const layouts = await this.prisma.liveLayout.findMany({ where: { userId }, select: { id: true } });
    return new Set(layouts.map((l) => l.id));
  }

  private enfeitar(r: { id: string; name: string; paradas: unknown; updatedAt: Date }) {
    const paradas = (Array.isArray(r.paradas) ? r.paradas : []) as ParadaDaRonda[];
    return {
      id: r.id,
      name: r.name,
      paradas,
      // A tela mostra isto ao montar: saber que a volta leva 4 minutos muda a
      // decisão de quantas paradas colocar.
      duracaoDaVoltaSegundos: duracaoDaVolta(paradas),
      updatedAt: r.updatedAt,
    };
  }

  async listar(user: AuthUser) {
    const itens = await this.prisma.ronda.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
    });
    return itens.map((r) => this.enfeitar(r));
  }

  async criar(user: AuthUser, dto: { name?: string; paradas?: unknown }) {
    const name = String(dto?.name ?? '').trim().slice(0, 80);
    if (!name) throw new BadRequestException('Dê um nome à ronda.');
    const conhecidos = await this.layoutsDoUsuario(user.id);
    const v = validarParadas(dto?.paradas, conhecidos);
    if (!v.ok) throw new BadRequestException(this.explicar(v.motivo, v.detalhe));
    const criada = await this.prisma.ronda.create({
      data: { userId: user.id, name, paradas: v.paradas as never },
    });
    return this.enfeitar(criada);
  }

  async atualizar(user: AuthUser, id: string, dto: { name?: string; paradas?: unknown }) {
    const atual = await this.prisma.ronda.findFirst({ where: { id, userId: user.id } });
    if (!atual) throw new NotFoundException('Ronda não encontrada.');

    const dados: { name?: string; paradas?: never } = {};
    if (dto?.name !== undefined) {
      const name = String(dto.name).trim().slice(0, 80);
      if (!name) throw new BadRequestException('Dê um nome à ronda.');
      dados.name = name;
    }
    if (dto?.paradas !== undefined) {
      const conhecidos = await this.layoutsDoUsuario(user.id);
      const v = validarParadas(dto.paradas, conhecidos);
      if (!v.ok) throw new BadRequestException(this.explicar(v.motivo, v.detalhe));
      dados.paradas = v.paradas as never;
    }
    const salva = await this.prisma.ronda.update({ where: { id }, data: dados });
    return this.enfeitar(salva);
  }

  async remover(user: AuthUser, id: string) {
    const atual = await this.prisma.ronda.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!atual) throw new NotFoundException('Ronda não encontrada.');
    await this.prisma.ronda.delete({ where: { id } });
    return { ok: true };
  }

  /** Mensagem em português do motivo — o operador não lê chave de erro. */
  private explicar(motivo: string, detalhe?: string): string {
    switch (motivo) {
      case 'sem-paradas':
        return 'Escolha pelo menos um mosaico para a ronda.';
      case 'paradas-demais':
        return `Ronda longa demais (${detalhe}). Uma volta que não termina no turno não serve.`;
      case 'layout-invalido':
        return 'Um dos mosaicos não existe mais. Remova-o da ronda.';
      case 'layout-repetido-em-sequencia':
        return 'O mesmo mosaico aparece duas vezes seguidas — a tela não mudaria e pareceria travada.';
      default:
        return 'Não foi possível salvar a ronda.';
    }
  }
}
