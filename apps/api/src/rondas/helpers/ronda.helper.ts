/**
 * RONDA: o mural passa de um mosaico para outro, sozinho.
 *
 * Pedido em 25/08/2026: "você cria uma grid, seleciona quantas quiser, e essas
 * grids abrem um mural que passa a cada minuto ou segundo que você definir POR
 * GRID. De fato é um slider de grid."
 *
 * O nome é o do ofício: o vigia faz a RONDA, passando de ponto em ponto. Cada
 * parada tem seu tempo — o portão merece mais que o corredor.
 *
 * O QUE ESTE MÓDULO GARANTE
 * -------------------------
 * A rotação é o coração da tela, e errar nela deixa o operador olhando uma
 * imagem parada achando que está vendo tudo — o pior defeito possível num mural
 * de segurança, porque ele não parece defeito.
 *
 * Puro: sem relógio de verdade, sem tela, sem banco.
 */

export type ParadaDaRonda = {
  /** Mosaico a exibir. */
  layoutId: string;
  /** Quanto tempo ele fica na tela. */
  segundos: number;
};

/** Menos que isto não dá tempo de o vídeo aparecer — a tela piscaria em vão. */
export const MIN_SEGUNDOS = 5;
/** Mais que isto não é ronda, é mosaico fixo. */
export const MAX_SEGUNDOS = 3600;
export const SEGUNDOS_PADRAO = 30;
/** Teto de paradas: ronda longa demais nunca completa a volta num turno. */
export const MAX_PARADAS = 40;

export type ResultadoDaValidacao =
  | { ok: true; paradas: ParadaDaRonda[] }
  | { ok: false; motivo: 'sem-paradas' | 'paradas-demais' | 'layout-invalido' | 'layout-repetido-em-sequencia'; detalhe?: string };

/**
 * Normaliza e valida as paradas.
 *
 * `layoutsConhecidos` vem de quem chamou: mosaico apagado não pode ficar na
 * ronda, senão o mural mostra tela preta no meio da volta e ninguém entende
 * por quê.
 */
export function validarParadas(
  bruto: unknown,
  layoutsConhecidos: Set<string>,
): ResultadoDaValidacao {
  const lista = Array.isArray(bruto) ? bruto : [];
  if (!lista.length) return { ok: false, motivo: 'sem-paradas' };
  if (lista.length > MAX_PARADAS) {
    return { ok: false, motivo: 'paradas-demais', detalhe: `máximo de ${MAX_PARADAS}` };
  }

  const paradas: ParadaDaRonda[] = [];
  for (const item of lista) {
    const layoutId = String((item as ParadaDaRonda)?.layoutId ?? '').trim();
    if (!layoutId || !layoutsConhecidos.has(layoutId)) {
      return { ok: false, motivo: 'layout-invalido', detalhe: layoutId || '(vazio)' };
    }
    // `Number(null)` devolve 0 em JavaScript — sem esta guarda, tempo ausente
    // viraria zero e o mosaico passaria voando. Já custou defeito em produção
    // quatro vezes no mesmo dia (teto de câmeras e expiração de conversa).
    const cru = (item as ParadaDaRonda)?.segundos;
    const n = cru === null || cru === undefined || String(cru).trim() === '' ? SEGUNDOS_PADRAO : Number(cru);
    const segundos = Number.isFinite(n)
      ? Math.min(MAX_SEGUNDOS, Math.max(MIN_SEGUNDOS, Math.round(n)))
      : SEGUNDOS_PADRAO;
    paradas.push({ layoutId, segundos });
  }

  // Duas paradas seguidas no MESMO mosaico não trocam nada na tela: o operador
  // vê a imagem parada pelo dobro do tempo e conclui que a ronda travou.
  for (let i = 1; i < paradas.length; i += 1) {
    if (paradas[i].layoutId === paradas[i - 1].layoutId) {
      return { ok: false, motivo: 'layout-repetido-em-sequencia', detalhe: paradas[i].layoutId };
    }
  }

  return { ok: true, paradas };
}

/** Quanto dura uma volta completa. É o que a tela mostra ao montar a ronda. */
export function duracaoDaVolta(paradas: ParadaDaRonda[]): number {
  return paradas.reduce((soma, p) => soma + (Number(p.segundos) || 0), 0);
}

/**
 * A próxima parada.
 *
 * Circular de propósito: a ronda não termina, ela dá a volta. E a conta é feita
 * sobre o TAMANHO ATUAL da lista — se alguém apagar um mosaico enquanto a ronda
 * roda, o índice não fica apontando para o vazio.
 */
export function proximaParada(indiceAtual: number, total: number): number {
  if (total <= 0) return 0;
  const atual = Number.isFinite(indiceAtual) ? Math.max(0, Math.floor(indiceAtual)) : 0;
  return (atual + 1) % total;
}

/**
 * Em que parada a ronda está, dado o tempo decorrido.
 *
 * Serve para a ronda ficar no mesmo ponto em telas diferentes e para recuperar
 * a posição depois de a página recarregar — sem isto, recarregar volta ao
 * começo e o operador perde a volta.
 */
export function paradaNoInstante(paradas: ParadaDaRonda[], segundosDecorridos: number): {
  indice: number;
  segundosNaParada: number;
} {
  const volta = duracaoDaVolta(paradas);
  if (!paradas.length || volta <= 0) return { indice: 0, segundosNaParada: 0 };
  let restante = ((Number(segundosDecorridos) || 0) % volta + volta) % volta;
  for (let i = 0; i < paradas.length; i += 1) {
    if (restante < paradas[i].segundos) return { indice: i, segundosNaParada: restante };
    restante -= paradas[i].segundos;
  }
  return { indice: paradas.length - 1, segundosNaParada: 0 };
}
