import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { type AuthUser } from '../common/types/auth-user.type';
import { LiveLayoutsService } from '../live-layouts/live-layouts.service';
import {
  normalizarDestinatarios,
  origemDe,
  pessoasAlcancadas,
  podeEditar,
  type Destinatarios,
} from '../live-layouts/helpers/compartilhamento.helper';
import { duracaoDaVolta, validarParadas, type ParadaDaRonda } from './helpers/ronda.helper';

/**
 * RONDAS: rodízio de mosaicos no mural.
 *
 * Até 25/08/2026 a ronda era só de quem a criou. Desde 26/08 o administrador
 * monta e ENTREGA — como o mosaico. Duas leituras, iguais às dos mosaicos:
 *   - `listar`      = "Minhas rondas": as que EU posso rodar
 *   - `listarAdmin` = "Rondas": as que EU administro (só admin)
 *
 * Diferença deliberada em relação ao concorrente: lá o tempo é UM só para a
 * ronda inteira. Aqui cada parada tem o seu, porque o portão não precisa do
 * mesmo tempo de tela que o estacionamento.
 */
@Injectable()
export class RondasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly layouts: LiveLayoutsService,
  ) {}

  private ehAdmin(user: AuthUser): boolean {
    return user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN;
  }

  private async gruposDoUsuario(userId: string): Promise<string[]> {
    const perms = await this.prisma.cameraPermission.findMany({
      where: { userId, groupId: { not: null } },
      select: { groupId: true },
      distinct: ['groupId'],
    });
    return perms.map((p) => p.groupId as string);
  }

  /**
   * Os mosaicos que ESTE usuário pode pôr numa ronda: os dele e os que
   * recebeu. Antes era só `where: { userId }` — o administrador não conseguia
   * montar ronda com mosaico que ele mesmo entregou a outra equipe.
   */
  private async layoutsUtilizaveis(user: AuthUser): Promise<Set<string>> {
    return this.layouts.idsUtilizaveis(user);
  }

  private enfeitar(
    r: { id: string; userId: string; name: string; paradas: unknown; active: boolean; showOnMobile: boolean; updatedAt: Date },
    user: AuthUser,
  ) {
    const paradas = (Array.isArray(r.paradas) ? r.paradas : []) as ParadaDaRonda[];
    return {
      id: r.id,
      name: r.name,
      paradas,
      active: r.active,
      showOnMobile: r.showOnMobile,
      origem: origemDe({ donoId: r.userId, usuarioId: user.id }),
      podeEditar: podeEditar({ donoId: r.userId, usuarioId: user.id, ehAdmin: this.ehAdmin(user) }),
      // A tela mostra isto ao montar: saber que a volta leva 4 minutos muda a
      // decisão de quantas paradas colocar.
      duracaoDaVoltaSegundos: duracaoDaVolta(paradas),
      updatedAt: r.updatedAt,
    };
  }

  /** "Minhas rondas": as minhas e as que me entregaram. */
  async listar(user: AuthUser) {
    const grupoIds = await this.gruposDoUsuario(user.id);
    const itens = await this.prisma.ronda.findMany({
      where: {
        OR: [
          { userId: user.id },
          { active: true, shares: { some: { userId: user.id } } },
          ...(grupoIds.length
            ? [{ active: true, shares: { some: { groupId: { in: grupoIds } } } }]
            : []),
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });
    return itens.map((r) => this.enfeitar(r, user));
  }

  /** "Rondas": a tela de administração, com quem recebeu cada uma. */
  async listarAdmin(user: AuthUser) {
    if (!this.ehAdmin(user)) throw new ForbiddenException('Só administradores gerenciam rondas.');
    const itens = await this.prisma.ronda.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
        shares: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            group: { select: { id: true, name: true } },
          },
        },
      },
    });

    return Promise.all(
      itens.map(async (r) => {
        const paradas = (Array.isArray(r.paradas) ? r.paradas : []) as ParadaDaRonda[];
        const grupos = r.shares.filter((s) => s.groupId).map((s) => s.groupId as string);
        const usuariosPorGrupo = grupos.length ? await this.usuariosDosGrupos(grupos) : [];
        return {
          id: r.id,
          name: r.name,
          mosaicos: paradas.length,
          duracaoDaVoltaSegundos: duracaoDaVolta(paradas),
          active: r.active,
          showOnMobile: r.showOnMobile,
          dono: r.user,
          destinatarios: {
            usuarios: r.shares.filter((s) => s.user).map((s) => s.user),
            grupos: r.shares.filter((s) => s.group).map((s) => s.group),
          },
          usuariosAlcancados: pessoasAlcancadas({
            donoId: r.userId,
            usuariosDiretos: r.shares.filter((s) => s.userId).map((s) => s.userId as string),
            usuariosPorGrupo,
          }).length,
          updatedAt: r.updatedAt,
        };
      }),
    );
  }

  private async usuariosDosGrupos(grupoIds: string[]): Promise<string[]> {
    const perms = await this.prisma.cameraPermission.findMany({
      where: { groupId: { in: grupoIds } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return perms.map((p) => p.userId);
  }

  async criar(
    user: AuthUser,
    dto: { name?: string; paradas?: unknown; active?: boolean; showOnMobile?: boolean; destinatarios?: unknown },
  ) {
    const name = String(dto?.name ?? '').trim().slice(0, 80);
    if (!name) throw new BadRequestException('Dê um nome à ronda.');
    const conhecidos = await this.layoutsUtilizaveis(user);
    const v = validarParadas(dto?.paradas, conhecidos);
    if (!v.ok) throw new BadRequestException(this.explicar(v.motivo, v.detalhe));
    const destinatarios = await this.destinatariosValidados(user, dto?.destinatarios);
    const criada = await this.prisma.ronda.create({
      data: {
        userId: user.id,
        name,
        paradas: v.paradas as never,
        ...(dto?.active !== undefined ? { active: dto.active } : {}),
        ...(dto?.showOnMobile !== undefined ? { showOnMobile: dto.showOnMobile } : {}),
        shares: { create: this.linhasDeEntrega(destinatarios) },
      },
    });
    return this.enfeitar(criada, user);
  }

  async atualizar(
    user: AuthUser,
    id: string,
    dto: { name?: string; paradas?: unknown; active?: boolean; showOnMobile?: boolean; destinatarios?: unknown },
  ) {
    const atual = await this.exigirPoderDeEdicao(user, id);

    const dados: { name?: string; paradas?: never; active?: boolean; showOnMobile?: boolean } = {};
    if (dto?.name !== undefined) {
      const name = String(dto.name).trim().slice(0, 80);
      if (!name) throw new BadRequestException('Dê um nome à ronda.');
      dados.name = name;
    }
    if (dto?.paradas !== undefined) {
      const conhecidos = await this.layoutsUtilizaveis(user);
      const v = validarParadas(dto.paradas, conhecidos);
      if (!v.ok) throw new BadRequestException(this.explicar(v.motivo, v.detalhe));
      dados.paradas = v.paradas as never;
    }
    if (dto?.active !== undefined) dados.active = dto.active;
    if (dto?.showOnMobile !== undefined) dados.showOnMobile = dto.showOnMobile;

    const trocaEntrega = dto?.destinatarios !== undefined;
    const destinatarios = trocaEntrega
      ? await this.destinatariosValidados(user, dto.destinatarios)
      : null;

    const salva = await this.prisma.$transaction(async (tx) => {
      if (destinatarios) {
        await tx.rondaShare.deleteMany({ where: { rondaId: atual.id } });
        await tx.rondaShare.createMany({
          data: this.linhasDeEntrega(destinatarios).map((l) => ({ ...l, rondaId: atual.id })),
        });
      }
      return tx.ronda.update({ where: { id: atual.id }, data: dados });
    });
    return this.enfeitar(salva, user);
  }

  async remover(user: AuthUser, id: string) {
    const atual = await this.exigirPoderDeEdicao(user, id);
    await this.prisma.ronda.delete({ where: { id: atual.id } });
    return { ok: true };
  }

  /** Quem recebeu a ronda RODA a ronda; quem a criou é quem a muda. */
  private async exigirPoderDeEdicao(user: AuthUser, id: string) {
    const ronda = await this.prisma.ronda.findUnique({ where: { id } });
    if (!ronda) throw new NotFoundException('Ronda não encontrada.');
    if (!podeEditar({ donoId: ronda.userId, usuarioId: user.id, ehAdmin: this.ehAdmin(user) })) {
      throw new ForbiddenException('Esta ronda é de outra pessoa. Você pode rodá-la, não alterá-la.');
    }
    return ronda;
  }

  private async destinatariosValidados(user: AuthUser, bruto: unknown): Promise<Destinatarios> {
    const d = normalizarDestinatarios(bruto);
    if (!d.usuarios.length && !d.grupos.length) return d;
    if (!this.ehAdmin(user)) {
      throw new ForbiddenException('Somente administradores entregam rondas a outras pessoas.');
    }
    const [usuarios, grupos] = await Promise.all([
      d.usuarios.length
        ? this.prisma.user.findMany({ where: { id: { in: d.usuarios } }, select: { id: true } })
        : Promise.resolve([]),
      d.grupos.length
        ? this.prisma.cameraGroup.findMany({ where: { id: { in: d.grupos } }, select: { id: true } })
        : Promise.resolve([]),
    ]);
    if (usuarios.length !== d.usuarios.length || grupos.length !== d.grupos.length) {
      throw new BadRequestException('Há destinatário que não existe mais. Recarregue a lista.');
    }
    return d;
  }

  private linhasDeEntrega(d: Destinatarios) {
    return [
      ...d.usuarios.map((userId) => ({ userId, groupId: null as string | null })),
      ...d.grupos.map((groupId) => ({ userId: null as string | null, groupId })),
    ];
  }

  /** Mensagem em português do motivo — o operador não lê chave de erro. */
  private explicar(motivo: string, detalhe?: string): string {
    switch (motivo) {
      case 'sem-paradas':
        return 'Escolha pelo menos um mosaico para a ronda.';
      case 'paradas-demais':
        return `Ronda longa demais (${detalhe}). Uma volta que não termina no turno não serve.`;
      case 'layout-invalido':
        return 'Um dos mosaicos não existe mais, ou não é seu. Remova-o da ronda.';
      case 'layout-repetido-em-sequencia':
        return 'O mesmo mosaico aparece duas vezes seguidas — a tela não mudaria e pareceria travada.';
      default:
        return 'Não foi possível salvar a ronda.';
    }
  }
}
