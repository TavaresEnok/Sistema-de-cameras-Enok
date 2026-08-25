/**
 * A rotação da ronda, no lado do navegador.
 *
 * Cópia deliberada da regra do servidor (rondas/helpers/ronda.helper.ts): a
 * tela precisa saber em que parada está SEM perguntar ao servidor a cada
 * segundo. As duas implementações são pequenas, puras e cobertas por teste dos
 * dois lados — é o mesmo arranjo já usado na geometria do perímetro.
 */

export type Parada = { layoutId: string; segundos: number };

export function duracaoDaVolta(paradas: Parada[]): number {
  return paradas.reduce((soma, p) => soma + (Number(p.segundos) || 0), 0);
}

/** A ronda dá a VOLTA, não termina. */
export function proximaParada(indiceAtual: number, total: number): number {
  if (total <= 0) return 0;
  const atual = Number.isFinite(indiceAtual) ? Math.max(0, Math.floor(indiceAtual)) : 0;
  return (atual + 1) % total;
}

/**
 * Em que parada a ronda está, dado o tempo decorrido.
 *
 * A posição vem do TEMPO, não de uma contagem de trocas: aba em segundo plano
 * tem o temporizador estrangulado pelo navegador, e contar trocas faria o mural
 * voltar atrasado — mostrando o corredor quando o operador espera o portão.
 */
export function paradaNoInstante(paradas: Parada[], segundosDecorridos: number): {
  indice: number;
  segundosNaParada: number;
} {
  const volta = duracaoDaVolta(paradas);
  if (!paradas.length || volta <= 0) return { indice: 0, segundosNaParada: 0 };
  const bruto = Number(segundosDecorridos);
  const seguro = Number.isFinite(bruto) ? bruto : 0;
  let restante = ((seguro % volta) + volta) % volta;
  for (let i = 0; i < paradas.length; i += 1) {
    if (restante < paradas[i].segundos) return { indice: i, segundosNaParada: restante };
    restante -= paradas[i].segundos;
  }
  return { indice: paradas.length - 1, segundosNaParada: 0 };
}
