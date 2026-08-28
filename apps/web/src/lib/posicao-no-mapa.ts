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
  /**
   * Todas as câmeras deste ponto têm a MESMA coordenada — aproximar não vai
   * separá-las, porque não existe posição diferente para mostrar.
   */
  mesmoPonto?: boolean;
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
      mesmoPonto: lista.length > 1,
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
  if (ponto.estimado && ponto.mesmoPonto) {
    // O caso que o dono viu: aproximar não separa porque a coordenada é a
    // MESMA para todas. Dizer isso evita que ele fique dando zoom em vão.
    return 'Estas câmeras têm exatamente a mesma posição estimada pela rede, '
      + 'por isso aproximar não as separa. Informe o endereço de cada uma para '
      + 'que apareçam no ponto certo.';
  }
  if (ponto.estimado && ponto.agrupado) {
    return 'Posição estimada pela rede — as câmeras não estão necessariamente aqui. '
      + 'Informe o endereço de cada uma para posicioná-las de verdade.';
  }
  if (ponto.mesmoPonto) return 'Câmeras no mesmo endereço — aproximar não as separa.';
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

// ── AGRUPAMENTO QUE RESPEITA O ZOOM ────────────────────────────────────────
//
// Pedido do dono em 28/08/2026: "no zoom baixo aparece um símbolo com o número
// de câmeras, o que está correto; mas ao aproximar deveria aparecer cada câmera
// no seu ponto/rua, e continua como um símbolo grande".
//
// Eram duas coisas diferentes, e só uma era defeito:
//
//  1. DEFEITO MEU: o agrupamento olhava só coordenadas IDÊNTICAS. Duas câmeras
//     a 20 metros uma da outra nunca se juntavam — ficavam sobrepostas e
//     ilegíveis no zoom de cidade. Corrigido aqui: junta por DISTÂNCIA NA TELA,
//     então aproximar realmente separa.
//
//  2. NÃO É DEFEITO: quando as câmeras têm a MESMA coordenada — o caso das 25
//     desta frota, todas no mesmo chute de IP — nenhum zoom as separa, porque
//     não existe posição diferente para mostrar. Separá-las ali seria inventar
//     rua. O que o mapa deve fazer é DIZER isso, e é o que `mesmoPonto` permite.

/** Um pixel do mapa vale quantos graus, neste zoom? (Web Mercator, 256px/ladrilho.) */
export function grausPorPixel(zoom: number): number {
  const z = Number.isFinite(zoom) ? Math.max(0, Math.min(22, zoom)) : 0;
  return 360 / (256 * Math.pow(2, z));
}

/** Distância mínima na tela para dois marcadores caberem lado a lado. */
export const RAIO_DE_AGRUPAMENTO_PX = 44;

/**
 * Agrupa por proximidade NA TELA, no zoom atual.
 *
 * Longitude é comprimida por `cos(latitude)`: um grau de longitude no Recife
 * vale bem menos metros que um grau de latitude, e ignorar isso agruparia
 * demais no sentido leste-oeste.
 */
export function agruparParaZoom(
  cameras: CameraNoMapa[],
  zoom: number,
  raioEmPixels: number = RAIO_DE_AGRUPAMENTO_PX,
): PontoNoMapa[] {
  const exatos = agruparPorPosicao(cameras);
  const limiteGraus = grausPorPixel(zoom) * raioEmPixels;

  const clusters: { lat: number; lon: number; partes: PontoNoMapa[] }[] = [];
  for (const ponto of exatos) {
    const fator = Math.max(0.2, Math.cos((ponto.latitude * Math.PI) / 180));
    const perto = clusters.find((c) => {
      const dLat = c.lat - ponto.latitude;
      const dLon = (c.lon - ponto.longitude) * fator;
      return Math.sqrt(dLat * dLat + dLon * dLon) < limiteGraus;
    });
    if (perto) perto.partes.push(ponto);
    else clusters.push({ lat: ponto.latitude, lon: ponto.longitude, partes: [ponto] });
  }

  return clusters.map((c) => {
    const cameras = c.partes.flatMap((p) => p.cameras);
    return {
      // A chave inclui a composição: sem isso o React reaproveitaria o marcador
      // de um agrupamento diferente ao trocar de zoom.
      id: c.partes.map((p) => p.id).join('+'),
      latitude: c.lat,
      longitude: c.lon,
      cameras,
      estimado: cameras.every(ehEstimativa),
      agrupado: cameras.length > 1,
      // Só há UMA posição real aqui dentro: aproximar não vai separar nada.
      mesmoPonto: c.partes.length === 1 && cameras.length > 1,
    };
  });
}
