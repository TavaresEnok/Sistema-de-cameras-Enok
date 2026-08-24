/**
 * TETO DE CÂMERAS contratado, definido na Central.
 *
 * "se dguardian dizer que vai pagar apenas para 50 cameras, eu tenho que
 *  limitar pela central o cadastro de 50 cameras no total para essa instalação"
 * (dono, 24/08/2026)
 *
 * Três decisões que a operação exige:
 *
 *   · SEM teto definido = SEM limite. Um campo esquecido no painel não pode
 *     travar o cadastro de um cliente que pagou por mais câmeras. Errar para
 *     este lado custa uma cobrança a menos; errar para o outro trava a
 *     instalação de quem está em dia.
 *   · A conta é do TOTAL cadastrado, não das ativas. Desativar câmera é um
 *     clique e voltaria a ser um jeito trivial de furar o contrato.
 *   · Quem já passou do teto (contrato reduzido depois do cadastro) NÃO tem
 *     câmera apagada nem desativada: apenas para de cadastrar novas. Apagar
 *     imagem de cliente por questão comercial é dano que não se desfaz.
 */

export type DecisaoDeTeto = {
  permitido: boolean;
  /** Quantas ainda cabem. null quando não há teto. */
  vagas: number | null;
  motivo: 'sem-teto' | 'dentro-do-teto' | 'teto-atingido' | 'acima-do-teto';
};

export function podeCadastrarCamera(
  cadastradas: number,
  teto: number | null | undefined,
  quantidade = 1,
): DecisaoDeTeto {
  const atual = Math.max(0, Math.floor(Number(cadastradas) || 0));
  const pedidas = Math.max(1, Math.floor(Number(quantidade) || 1));

  // Texto VAZIO é "sem teto", não teto zero. `Number('')` devolve 0, e sem esta
  // guarda um campo em branco na Central bloquearia TODO cadastro de câmera do
  // cliente — falha silenciosa e catastrófica. Teto zero de verdade só existe
  // quando alguém escreve o número 0.
  const cru = typeof teto === 'string' ? (teto as string).trim() : teto;
  if (cru === null || cru === undefined || cru === '' || !Number.isFinite(Number(cru)) || Number(cru) < 0) {
    return { permitido: true, vagas: null, motivo: 'sem-teto' };
  }
  void 0;

  const limite = Math.floor(Number(cru));
  const vagas = Math.max(0, limite - atual);

  if (atual > limite) return { permitido: false, vagas: 0, motivo: 'acima-do-teto' };
  if (pedidas > vagas) return { permitido: false, vagas, motivo: 'teto-atingido' };
  return { permitido: true, vagas, motivo: 'dentro-do-teto' };
}

/** Mensagem para o administrador da instalação — diz o número e o caminho. */
export function explicarTeto(d: DecisaoDeTeto, teto: number | null | undefined): string {
  if (d.motivo === 'acima-do-teto') {
    return `Esta instalação já tem mais câmeras do que o contrato permite (${teto}). `
      + 'Nenhuma câmera foi removida; para cadastrar novas, fale com o suporte.';
  }
  return `Limite de ${teto} câmeras atingido para esta instalação. `
    + 'Para cadastrar mais, é preciso ampliar o contrato.';
}
