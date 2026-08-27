/**
 * LIMPEZA DO HISTÓRICO — o que pode ser esquecido, e o que jamais.
 *
 * Pedido do dono em 27/08/2026: "o banco deve estar cheio de alertas e alarmes,
 * poderia fazer uma limpeza também".
 *
 * Estava mesmo. Medido nesta instalação: 178.147 linhas de auditoria desde 1º de
 * maio, das quais 96,5% eram ruído de operação — entrega de notificação, criação
 * de token de transmissão, falha de player. O rastro que importa de verdade eram
 * 4.435 linhas.
 *
 * A REGRA QUE NÃO PODE CAIR
 * -------------------------
 * NA DÚVIDA, GUARDA. A lista abaixo é de RUÍDO, não de rastro. Ação que este
 * módulo não reconhece é preservada — sempre. Num sistema de câmeras, o registro
 * de quem viu qual gravação, quem entrou, quem mexeu em câmera e quem disparou
 * um pânico é prova. Perder prova por causa de uma faxina é um estrago que não
 * se desfaz, e ninguém percebe até o dia em que a prova faria falta.
 *
 * Por isso a lista é fechada e explícita: para acrescentar ruído é preciso
 * escrever o nome dele aqui, olhando para ele.
 *
 * Puro: sem banco, sem relógio.
 */

/**
 * Ações de OPERAÇÃO. Alto volume, valor curto: servem para diagnosticar o que
 * está acontecendo agora, não para provar o que aconteceu em maio.
 */
export const ACOES_DE_RUIDO = new Set([
  // Uma linha por notificação entregue. 71.435 em quatro meses aqui.
  'alarm.notification.delivery',
  // Uma linha por vez que alguém abre um vídeo. 53.749.
  'stream.token.create',
  // Diagnóstico de player. Vale por dias, não por meses. 40.305.
  'stream.live.failure',
  'playback.token.create',
  'playback.vod.playlist',
  // Retentativa automática de assinatura: ruído de máquina falando com máquina.
  'investigation.export.signature.retry',
  // Movimento de PTZ: o operador mexeu a câmera. Operação, não prova.
  'ptz.start',
  'ptz.stop',
]);

export type ClasseDeRegistro = 'ruido' | 'rastro';

/**
 * Ruído ou rastro?
 *
 * O padrão é `rastro`. Isto é deliberado e é o coração do módulo: uma ação nova,
 * criada por alguém no futuro, nasce protegida. O oposto — apagar por padrão —
 * faria a próxima funcionalidade perder o histórico dela em silêncio.
 */
export function classificar(acao: string | null | undefined): ClasseDeRegistro {
  const a = String(acao ?? '').trim();
  return ACOES_DE_RUIDO.has(a) ? 'ruido' : 'rastro';
}

/** As ações de ruído, prontas para virar um `IN (...)` na consulta. */
export function acoesQuePodemSerEsquecidas(): string[] {
  return [...ACOES_DE_RUIDO];
}

export type PrazosDeGuarda = {
  /** Dias de guarda do ruído de operação. */
  ruidoDias: number;
  /** Dias de guarda do rastro. Longo de propósito. */
  rastroDias: number;
  /** Dias de guarda dos alarmes já resolvidos. */
  alarmeDias: number;
};

export const PRAZOS_PADRAO: PrazosDeGuarda = {
  ruidoDias: 30,
  // Dois anos. O rastro é pequeno (milhares de linhas, não centenas de milhares),
  // então guardar muito custa quase nada — e é exatamente o que se quer ter no
  // dia em que alguém pergunta "quem viu essa gravação em março?".
  rastroDias: 730,
  alarmeDias: 90,
};

/**
 * A data-limite de cada classe.
 *
 * `Number(null)` devolve 0 em JavaScript, e prazo zero apagaria TUDO na primeira
 * passagem. Esta guarda já evitou defeito em produção cinco vezes neste projeto;
 * aqui o estrago seria irreversível, então ela é obrigatória.
 */
export function limiteDeCorte(agora: number, dias: unknown, padrao: number): Date {
  const cru = dias === null || dias === undefined || String(dias).trim() === '' ? padrao : Number(dias);
  const d = Number.isFinite(cru) && cru > 0 ? Math.floor(cru) : padrao;
  return new Date(agora - d * 24 * 3600 * 1000);
}

export type PlanoDeLimpeza = {
  ruidoAntesDe: Date;
  rastroAntesDe: Date;
  alarmesAntesDe: Date;
  acoesDeRuido: string[];
};

/** Monta o plano completo, para o serviço só executar. */
export function planejarLimpeza(agora: number, prazos: Partial<PrazosDeGuarda> = {}): PlanoDeLimpeza {
  return {
    ruidoAntesDe: limiteDeCorte(agora, prazos.ruidoDias, PRAZOS_PADRAO.ruidoDias),
    rastroAntesDe: limiteDeCorte(agora, prazos.rastroDias, PRAZOS_PADRAO.rastroDias),
    alarmesAntesDe: limiteDeCorte(agora, prazos.alarmeDias, PRAZOS_PADRAO.alarmeDias),
    acoesDeRuido: acoesQuePodemSerEsquecidas(),
  };
}
