/**
 * A LICENÇA VENCE SOZINHA quando a instalação para de falar com a Central.
 *
 * Até 24/08/2026 a lógica era "pergunte à Central se pode". Quando a Central
 * não respondia, a instalação apenas anotava o erro no log e seguia — e o
 * estado `UNKNOWN`, que é o de quem nunca conseguiu falar, LIBERA TUDO.
 *
 * Consequência prática: bastava tirar a máquina da internet para o sistema
 * rodar para sempre, completo. Não era preciso nem má-fé: instalação que nunca
 * alcançou a Central nascia no estado mais permissivo de todos.
 *
 * A regra passa a ser a do ticket de estacionamento: a instalação carrega uma
 * permissão que VENCE, e cada contato com a Central a renova. Sem contato, ela
 * expira sozinha — ninguém precisa mandar bloquear.
 *
 * Os prazos foram escolhidos pelo dono em 24/08/2026, e a divisão em dois
 * degraus é deliberada:
 *
 *   · 10 dias → RESTRIÇÃO. Incomoda sem descobrir o cliente: ele para de
 *     cadastrar câmera, perde IA avançada e atualizações, mas CONTINUA
 *     gravando e vendo ao vivo.
 *   · +5 dias → SUSPENSÃO. Aí sim para de gravar e de exibir ao vivo.
 *
 * Por que não suspender direto aos 10: cliente honesto fica sem link por obra
 * na rua, troca de provedor, roteador queimado. Se o sistema parasse de gravar
 * nesses casos e acontecesse um furto, o prejuízo seria dele e o problema
 * nosso. Quinze dias de silêncio total já é outro tipo de situação.
 *
 * Puro de propósito: a política inteira é testável sem banco, sem rede e sem
 * relógio de verdade.
 */

export type EstadoDaLicenca = 'UNKNOWN' | 'ACTIVE' | 'GRACE' | 'RESTRICTED' | 'SUSPENDED';

/** Dias de silêncio até restringir. */
export const DIAS_ATE_RESTRINGIR = 10;
/** Dias de silêncio até suspender (10 + 5). */
export const DIAS_ATE_SUSPENDER = 15;
/** A partir daqui o painel avisa o operador, antes de qualquer corte. */
export const DIAS_PARA_COMECAR_A_AVISAR = 7;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Gravidade dos estados: o maior número manda quando dois se cruzam. */
const GRAVIDADE: Record<EstadoDaLicenca, number> = {
  ACTIVE: 0,
  GRACE: 1,
  UNKNOWN: 2,
  RESTRICTED: 3,
  SUSPENDED: 4,
};

/**
 * Quantos dias desde o último contato — à prova de relógio atrasado.
 *
 * Atrasar o relógio da máquina é a forma óbvia de burlar um prazo. Por isso a
 * conta nunca usa um "agora" ANTERIOR ao maior instante já observado: se o
 * relógio voltou, vale a marca mais alta que a instalação já viu. Andar para
 * trás no tempo não devolve dias de licença.
 *
 * Sem contato nenhum registrado, devolve `Infinity`: nunca falou com a Central
 * é o pior caso, não o melhor. Era exatamente o inverso disso que deixava
 * `UNKNOWN` liberar tudo.
 */
export function diasSemContato(
  ultimoContatoMs: number | null | undefined,
  agoraMs: number,
  maiorInstanteVistoMs?: number | null,
): number {
  if (!Number.isFinite(ultimoContatoMs as number) || !ultimoContatoMs || ultimoContatoMs <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const agora = Math.max(
    Number(agoraMs) || 0,
    Number(maiorInstanteVistoMs) || 0,
    Number(ultimoContatoMs) || 0,
  );
  return Math.max(0, (agora - Number(ultimoContatoMs)) / DIA_MS);
}

/** O estado que o SILÊNCIO impõe, ignorando o que a Central disse. */
export function estadoPorSilencio(dias: number): EstadoDaLicenca {
  if (!Number.isFinite(dias)) return 'SUSPENDED';
  if (dias >= DIAS_ATE_SUSPENDER) return 'SUSPENDED';
  if (dias >= DIAS_ATE_RESTRINGIR) return 'RESTRICTED';
  return 'ACTIVE';
}

/**
 * O estado que vale é o MAIS SEVERO entre o da Central e o do silêncio.
 *
 * A Central pode restringir uma instalação que fala com ela todo dia (contrato
 * em atraso, por exemplo); e o silêncio pode restringir uma instalação que a
 * Central considerava ativa. Nenhum dos dois anula o outro.
 */
export function combinarEstados(daCentral: EstadoDaLicenca, doSilencio: EstadoDaLicenca): EstadoDaLicenca {
  return GRAVIDADE[doSilencio] > GRAVIDADE[daCentral] ? doSilencio : daCentral;
}

export type DecisaoDeLicenca = {
  estado: EstadoDaLicenca;
  /** Dias inteiros de silêncio, para exibir ao operador. */
  diasSemContato: number;
  /** Dias até o PRÓXIMO corte; null quando já suspenso. */
  diasAteOProximoCorte: number | null;
  /** O painel deve avisar o operador agora? */
  avisar: boolean;
  /** Chave estável do motivo, para log e teste. */
  motivo: 'em-dia' | 'silencio-restringiu' | 'silencio-suspendeu' | 'central-restringiu' | 'nunca-falou';
};

export function decidirLicenca(entrada: {
  estadoDaCentral: EstadoDaLicenca;
  ultimoContatoMs: number | null | undefined;
  agoraMs: number;
  maiorInstanteVistoMs?: number | null;
}): DecisaoDeLicenca {
  const dias = diasSemContato(entrada.ultimoContatoMs, entrada.agoraMs, entrada.maiorInstanteVistoMs);
  const doSilencio = estadoPorSilencio(dias);
  const estado = combinarEstados(entrada.estadoDaCentral, doSilencio);

  const diasInteiros = Number.isFinite(dias) ? Math.floor(dias) : Number.POSITIVE_INFINITY;
  let diasAteOProximoCorte: number | null = null;
  if (estado !== 'SUSPENDED' && Number.isFinite(dias)) {
    const alvo = dias < DIAS_ATE_RESTRINGIR ? DIAS_ATE_RESTRINGIR : DIAS_ATE_SUSPENDER;
    diasAteOProximoCorte = Math.max(0, Math.ceil(alvo - dias));
  }

  let motivo: DecisaoDeLicenca['motivo'] = 'em-dia';
  if (!Number.isFinite(dias)) motivo = 'nunca-falou';
  else if (doSilencio === 'SUSPENDED') motivo = 'silencio-suspendeu';
  else if (doSilencio === 'RESTRICTED') motivo = 'silencio-restringiu';
  else if (estado === 'RESTRICTED' || estado === 'SUSPENDED') motivo = 'central-restringiu';

  return {
    estado,
    diasSemContato: diasInteiros,
    diasAteOProximoCorte,
    // Avisa desde antes do primeiro corte: o cliente não pode ser surpreendido.
    avisar: !Number.isFinite(dias) || dias >= DIAS_PARA_COMECAR_A_AVISAR,
    motivo,
  };
}
