import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { type AuthUser } from '../common/types/auth-user.type';
import { UserRole } from '@prisma/client';
import { CommercialPolicyService } from './commercial-policy.service';

/**
 * ESTADO DA LICENÇA para o PAINEL WEB.
 *
 * "tem que emitir o aviso apenas no sistema web e não para o app!" (dono,
 * 24/08/2026)
 *
 * O aviso de licença é assunto de quem ADMINISTRA a instalação, não de quem só
 * quer ver a câmera do celular. O aplicativo do cliente final não consulta esta
 * rota — e o pedido é explícito para que ninguém a ligue lá depois "para ficar
 * completo".
 *
 * O DETALHE só sai para administrador. Usuário comum do painel recebe o mínimo
 * (se há aviso e o texto genérico), porque prazo de contrato e dias sem contato
 * são informação comercial do dono da instalação, não de todo operador.
 */
@Controller('license')
@UseGuards(JwtAuthGuard)
export class CommercialPolicyController {
  constructor(private readonly policy: CommercialPolicyService) {}

  @Get('status')
  async status(@CurrentUser() user: AuthUser) {
    const p = await this.policy.getPolicy();
    const ehAdmin = user?.role === UserRole.ADMIN || user?.role === UserRole.SUPER_ADMIN;

    if (!ehAdmin) {
      return {
        avisar: p.avisarSobreContato && p.licenseStatus !== 'ACTIVE',
        licenseStatus: p.licenseStatus,
        mensagem: p.licenseStatus === 'ACTIVE'
          ? null
          : 'O sistema está com restrições. Fale com o administrador.',
      };
    }

    return {
      avisar: p.avisarSobreContato,
      licenseStatus: p.licenseStatus,
      statusDaCentral: p.statusDaCentral,
      diasSemContato: Number.isFinite(p.diasSemContato) ? p.diasSemContato : null,
      diasAteOProximoCorte: p.diasAteOProximoCorte,
      motivo: p.motivoDaLicenca,
      maxCameras: p.maxCameras,
      lastSyncAt: p.lastSyncAt,
      mensagem: this.mensagem(p),
    };
  }

  /** Texto para o administrador: o que houve, o que acontece e quando. */
  private mensagem(p: Awaited<ReturnType<CommercialPolicyService['getPolicy']>>): string | null {
    if (p.motivoDaLicenca === 'nunca-falou') {
      return 'Esta instalação nunca conseguiu falar com a Central. '
        + 'Sem esse contato o sistema fica suspenso: confira a internet do servidor.';
    }
    if (p.motivoDaLicenca === 'silencio-suspendeu') {
      return `O sistema está SUSPENSO: ${p.diasSemContato} dias sem falar com a Central. `
        + 'Gravação e visualização ao vivo estão paradas. Restabeleça a internet do servidor.';
    }
    if (p.motivoDaLicenca === 'silencio-restringiu') {
      return `${p.diasSemContato} dias sem falar com a Central. Cadastro de câmeras, IA avançada e `
        + `atualizações estão bloqueados. Em ${p.diasAteOProximoCorte} dia(s) a gravação também para.`;
    }
    if (p.avisarSobreContato && p.diasAteOProximoCorte !== null) {
      return `Sem contato com a Central há ${p.diasSemContato} dias. `
        + `Em ${p.diasAteOProximoCorte} dia(s) o sistema começa a bloquear funções.`;
    }
    if (p.licenseStatus !== 'ACTIVE') {
      return p.licenseMessage || 'A licença desta instalação está com restrições.';
    }
    return null;
  }
}
