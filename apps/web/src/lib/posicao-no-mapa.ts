/**
 * O MAPA NÃO PODE MENTIR SOBRE ONDE A CÂMERA ESTÁ.
 *
 * Defeito corrigido em 27/08/2026. O mapa recebia 29 câmeras que o servidor
 * havia posicionado por ESTIMATIVA DE IP — todas caindo em dois pontos, que são
 * as saídas de internet do provedor, não os lugares onde as câmeras estão. Para
 * os marcadores não ficarem um sobre o outro, a tela os espalhava num leque de
 * uns 130 metros.
 *
 * O comentário no código dizia "é só visual". Não era. Quem olhava via 25 pinos
 * distribuídos por um bairro, cada um numa posição própria, e concluía que o
 * sistema sabia onde cada câmera estava. Num sistema de segurança isso é pior
 * que um mapa vazio: manda alguém a um endereço que não significa nada.
 *
 * É a regra §5 dos nossos padrões — "tela oferecida ao operador NÃO SIMULA".
 * O banco sempre foi honesto (grava "Estimativa por IP público"); era a tela
 * que não contava.
 *
 * A REGRA AQUI
 * ------------
 * Posição estimada NUNCA é espalhada. Ela vira UM ponto com a contagem, dizendo
 * que é estimativa. Preciso é preciso; estimado se apresenta como estimado.
 *
 * Puro: sem mapa, sem rede, sem React.
 */

/** O servidor marca assim o que não veio de endereço conferido. */
export const MARCA_DE_ESTIMATIVA = 'Estimativa por ';

export type CameraNoMapa = {
  id: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  locationAddress?: string | null;
  isOnline?: boolean;
};

/**
 * Esta posição foi medida ou chutada?
 *
 * Só há duas origens: endereço convertido em coordenada (preciso o quanto o
 * endereço for) ou estimativa de IP (o ponto de saída do provedor). O servidor
 * carimba a segunda no próprio endereço, e é esse carimbo que lemos.
 */
export function ehEstimativa(camera: CameraNoMapa): boolean {
  return String(camera.locationAddress ?? '').trimStart().startsWith(MARCA_DE_ESTIMATIVA);
}

/**
 * Tem coordenada de verdade?
 *
 * `Number(null)` devolve 0 em JavaScript, e zero é uma coordenada FINITA e
 * válida — fica no meio do Atlântico, na altura do golfo da Guiné. Sem esta
 * guarda, câmera com longitude vazia apareceria no mapa, no oceano, com cara de
 * dado real. É a sexta vez que esta armadilha aparece neste projeto; aqui ela
 * foi pega pelo próprio teste.
 */
function coordenada(valor: unknown): number | null {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

export function temPosicao(camera: CameraNoMapa): boolean {
  return coordenada(camera.latitude) !== null && coordenada(camera.longitude) !== null;
}

export type PontoNoMapa = {
  /** Chave estável do ponto, para o React. */
  id: string;
  latitude: number;
  longitude: number;
  cameras: CameraNoMapa[];
  /** Todas as câmeras deste ponto vieram de estimativa? */
  estimado: boolean;
  /** Mais de uma câmera no mesmo ponto. */
  agrupado: boolean;
};

/**
 * Junta as câmeras que estão exatamente na mesma coordenada.
 *
 * O arredondamento em 5 casas (~1 metro) é o que faz duas estimativas idênticas
 * caírem no mesmo balde. Duas câmeras com endereço real no mesmo prédio também
 * agrupam — e isso é correto: elas ESTÃO no mesmo lugar.
 */
export function agruparPorPosicao(cameras: CameraNoMapa[]): PontoNoMapa[] {
  const baldes = new Map<string, CameraNoMapa[]>();
  for (const camera of cameras) {
    if (!temPosicao(camera)) continue;
    const chave = `${(coordenada(camera.latitude) as number).toFixed(5)}:${(coordenada(camera.longitude) as number).toFixed(5)}`;
    baldes.set(chave, [...(baldes.get(chave) ?? []), camera]);
  }
  return [...baldes.entries()].map(([chave, lista]) => {
    const [lat, lon] = chave.split(':');
    return {
      id: chave,
      latitude: Number(lat),
      longitude: Number(lon),
      cameras: lista,
      // Um ponto só é "estimado" quando TUDO nele é estimativa. Se houver uma
      // câmera com endereço conferido, o ponto é real e o aviso seria falso.
      estimado: lista.every(ehEstimativa),
      agrupado: lista.length > 1,
    };
  });
}

/** O que o marcador escreve. */
export function rotuloDoPonto(ponto: PontoNoMapa): string {
  if (!ponto.agrupado) return ponto.cameras[0]?.name ?? 'Câmera';
  return `${ponto.cameras.length} câmeras`;
}

/** A frase que explica, sem enfeite, o que aquele ponto significa. */
export function explicacaoDoPonto(ponto: PontoNoMapa): string {
  if (ponto.estimado && ponto.agrupado) {
    return 'Posição estimada pela rede — as câmeras não estão necessariamente aqui. '
      + 'Informe o endereço de cada uma para posicioná-las de verdade.';
  }
  if (ponto.estimado) {
    return 'Posição estimada pela rede — a câmera não está necessariamente aqui. '
      + 'Informe o endereço para posicioná-la de verdade.';
  }
  if (ponto.agrupado) return 'Câmeras no mesmo endereço.';
  return ponto.cameras[0]?.locationAddress?.trim() || 'Endereço informado.';
}

/** Contagem para a faixa de aviso no topo da página. */
export function resumirMapa(cameras: CameraNoMapa[]) {
  const comPosicao = cameras.filter(temPosicao);
  const estimadas = comPosicao.filter(ehEstimativa).length;
  return {
    total: cameras.length,
    comPosicao: comPosicao.length,
    semPosicao: cameras.length - comPosicao.length,
    estimadas,
    conferidas: comPosicao.length - estimadas,
  };
}
