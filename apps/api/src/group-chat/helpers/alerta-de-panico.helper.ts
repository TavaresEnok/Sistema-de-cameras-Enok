/**
 * BOTÃO DE PÂNICO e a conversa do grupo.
 *
 * Pedido em 25/08/2026: "cinco câmeras num condomínio, grupo Condomínio, dez
 * usuários. Um deles vê algo estranho, clica em ALERTA, e todos daquele grupo
 * recebem push com vibração três vezes."
 *
 * DUAS COISAS, UMA SÓ FERRAMENTA
 * ------------------------------
 * O alerta e a conversa foram feitos juntos de propósito. Alerta sem conversa é
 * beco sem saída: dez pessoas recebem "atenção na câmera 3" e ninguém consegue
 * dizer "já vi, é o entregador" — então todas as dez vão olhar, ou nenhuma vai.
 * Conversa sem alerta ninguém abre.
 *
 * Por isso o alerta É uma mensagem, marcada como alerta, na mesma conversa. Uma
 * coisa para construir, uma para o usuário aprender.
 *
 * O QUE ESTE MÓDULO DECIDE (e por que é puro)
 * -------------------------------------------
 * Quem recebe, o que a mensagem diz e quando ela expira. Errar em "quem recebe"
 * é vazar imagem de condomínio para quem não mora nele; errar na expiração é
 * encher o disco ou apagar prova. As duas coisas precisam de teste sem banco.
 */

export type MembroDoGrupo = {
  userId: string;
  /** Quem disparou não precisa receber o próprio alerta. */
  ehAutor: boolean;
  /** Aparelhos registrados. Sem aparelho, não há push — mas a mensagem fica. */
  tokens: string[];
};

/**
 * Para quem o push vai.
 *
 * O AUTOR fica de fora: receber o próprio alerta assusta sem informar, e num
 * botão de pânico o susto extra é o que menos falta.
 *
 * Usuário sem aparelho registrado NÃO é erro: ele lê a mensagem quando abrir o
 * app. Tratar como falha faria o alerta parecer quebrado quando está correto.
 */
export function destinatariosDoAlerta(membros: MembroDoGrupo[]): {
  tokens: string[];
  semAparelho: number;
  alcancados: number;
} {
  const outros = membros.filter((m) => !m.ehAutor);
  const tokens = [...new Set(outros.flatMap((m) => m.tokens.filter(Boolean)))];
  return {
    tokens,
    semAparelho: outros.filter((m) => !m.tokens.length).length,
    alcancados: outros.filter((m) => m.tokens.length).length,
  };
}

/** Quanto tempo a conversa guarda. Padrão de 3 dias, pedido pelo dono. */
export const DIAS_DE_CONVERSA_PADRAO = 3;
/** Piso e teto: 0 apagaria a mensagem antes de alguém ler. */
const MIN_DIAS = 1;
const MAX_DIAS = 90;

export function quandoExpira(criadaEm: Date, dias: number | null | undefined): Date {
  // `null`/`undefined` significam "use o padrão", NUNCA zero. Em JavaScript
  // `Number(null)` devolve 0, e sem esta guarda a configuração ausente caía no
  // piso de 1 dia em vez dos 3 combinados — a mensagem sumia dois dias antes.
  //
  // É a QUARTA vez que esta mesma armadilha aparece em 25/08/2026 (teto de
  // câmeras na instalação, na Central, no conector, e agora aqui). Onde houver
  // um número que pode faltar, `Number()` precisa de guarda antes.
  // `String(dias).trim() === ''` cobre o texto vazio que chega de formulário,
  // sem que o TypeScript precise fingir que o tipo é string.
  if (dias === null || dias === undefined || String(dias).trim() === '') {
    return somarDias(criadaEm, DIAS_DE_CONVERSA_PADRAO);
  }
  const n = Number(dias);
  if (!Number.isFinite(n)) return somarDias(criadaEm, DIAS_DE_CONVERSA_PADRAO);
  return somarDias(criadaEm, Math.min(MAX_DIAS, Math.max(MIN_DIAS, Math.floor(n))));
}

function somarDias(base: Date, dias: number): Date {
  return new Date(base.getTime() + dias * 24 * 60 * 60 * 1000);
}

/**
 * O texto do push.
 *
 * Curto de propósito: numa tela bloqueada só entram poucas palavras, e o que
 * importa é QUEM chamou e ONDE. O resto se lê na conversa.
 *
 * NÃO leva o conteúdo da mensagem no alerta: o canal Android usado é privado na
 * tela bloqueada justamente para não expor o que se passa num condomínio a quem
 * pegar o aparelho da mesa.
 */
export function textoDoAlerta(entrada: {
  nomeDoGrupo: string;
  nomeDeQuemChamou: string;
  nomeDaCamera?: string | null;
}): { title: string; body: string } {
  const onde = entrada.nomeDaCamera ? ` — ${entrada.nomeDaCamera}` : '';
  return {
    title: `⚠ Alerta em ${entrada.nomeDoGrupo}`,
    body: `${entrada.nomeDeQuemChamou} pediu atenção${onde}.`,
  };
}

/** Limite de tamanho: mensagem é recado, não relatório. */
export const MAX_CARACTERES = 500;

export function limparTexto(bruto: unknown): string {
  return String(bruto ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CARACTERES);
}

/**
 * Freio contra repetição do botão.
 *
 * Sem freio, dez toques nervosos viram dez pushes com vibração para dez
 * pessoas — e a próxima vez que o alerta tocar, ninguém olha. O freio protege
 * a credibilidade do alerta, que é o único valor que ele tem.
 *
 * Segundo alerta DENTRO da janela não vira push novo: entra na conversa como
 * mensagem, para o histórico ficar honesto sobre quantas vezes foi pedido.
 */
export const SEGUNDOS_ENTRE_ALERTAS = 60;

export function podeDispararAlerta(ultimoAlertaMs: number | null, agoraMs: number): {
  pode: boolean;
  faltamSegundos: number;
} {
  if (!ultimoAlertaMs) return { pode: true, faltamSegundos: 0 };
  const decorrido = (agoraMs - ultimoAlertaMs) / 1000;
  if (decorrido >= SEGUNDOS_ENTRE_ALERTAS) return { pode: true, faltamSegundos: 0 };
  return { pode: false, faltamSegundos: Math.ceil(SEGUNDOS_ENTRE_ALERTAS - decorrido) };
}
