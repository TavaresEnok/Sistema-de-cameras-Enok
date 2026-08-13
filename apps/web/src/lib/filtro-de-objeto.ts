// Filtrar a linha do tempo por OBJETO — "mostre onde apareceu gente".
//
// É o motivo pelo qual alguém compra IA em vez de só gravar: achar o
// acontecimento sem assistir a oito horas de vídeo. A fila de Detecções já
// filtrava por rótulo; a Reprodução, onde o operador efetivamente procura, não.
//
// O dado já vinha: `GET /cameras/events-feed` devolve `metadata` inteiro, e a
// IA grava a classe em `metadata.semanticLabel`. A régua simplesmente jogava
// isso fora ao montar os marcadores.
//
// Módulo puro porque a regra que importa aqui é de SEGURANÇA DE LEITURA: um
// filtro que esconde demais faz o operador concluir que não houve nada.

/** As classes que o modelo reconhece e que fazem sentido procurar num VMS. */
export const OBJETOS_BUSCAVEIS = [
  { valor: 'pessoa', rotulo: 'Pessoa' },
  { valor: 'carro', rotulo: 'Carro' },
  { valor: 'moto', rotulo: 'Moto' },
  { valor: 'onibus', rotulo: 'Ônibus' },
] as const;

export type ObjetoBuscavel = (typeof OBJETOS_BUSCAVEIS)[number]['valor'];
/** `null` = sem filtro, mostra tudo (inclusive evento sem rótulo). */
export type FiltroDeObjeto = ObjetoBuscavel | null;

export type EventoComRotulo = {
  id: string;
  timestamp: string;
  severity: string;
  /** `metadata.semanticLabel` do backend. Ausente em evento que não é de objeto. */
  label?: string | null;
};

/** Lê o rótulo do metadata cru, tolerando formato inesperado sem quebrar. */
export function rotuloDoEvento(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const valor = (metadata as Record<string, unknown>).semanticLabel;
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim().toLowerCase();
  return limpo.length > 0 ? limpo : null;
}

/**
 * Aplica o filtro à lista de marcadores da régua.
 *
 * REGRA CENTRAL: sem filtro, NADA é escondido — inclusive o evento sem rótulo,
 * que é a maioria (movimento puro). Filtrar por engano o que não tem rótulo
 * esvaziaria a régua de quase todas as câmeras e o operador leria isso como
 * "não houve nada naquele dia".
 */
export function filtrarPorObjeto<T extends EventoComRotulo>(eventos: T[], filtro: FiltroDeObjeto): T[] {
  if (!filtro) return eventos;
  return eventos.filter((e) => (e.label ?? null) === filtro);
}

/**
 * O que dizer quando o filtro não achou nada. A frase muda conforme a causa,
 * porque as ações são diferentes: trocar o filtro, ou aceitar que não houve.
 */
export function explicarResultado(input: {
  filtro: FiltroDeObjeto;
  totalNoDia: number;
  totalFiltrado: number;
}): string | null {
  if (!input.filtro) return null;
  const nome = OBJETOS_BUSCAVEIS.find((o) => o.valor === input.filtro)?.rotulo.toLowerCase() ?? input.filtro;
  if (input.totalFiltrado > 0) {
    return `${input.totalFiltrado} marca(s) de ${nome} neste dia.`;
  }
  if (input.totalNoDia > 0) {
    // Distinção que evita o operador achar que o dia foi vazio: houve coisa,
    // só não do tipo procurado.
    return `Nenhum(a) ${nome} neste dia — mas houve ${input.totalNoDia} outra(s) detecção(ões). Tire o filtro para ver.`;
  }
  return `Nenhuma detecção neste dia.`;
}
