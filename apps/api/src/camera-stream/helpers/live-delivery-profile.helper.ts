import { envNumber } from '../../common/config/env-number.helper';

// 'original' = "máxima qualidade": serve o stream PRINCIPAL da câmera em
// PASSTHROUGH (sem transcode, inclusive H.265). O cliente prioriza WebRTC e usa
// HLS como contingência; o dispositivo decodifica HEVC, sem encode no servidor.
// `grid-hevc` usa a mesma fonte leve de `grid`, mas preserva o codec recebido.
// Ele tem path próprio para poder coexistir com o fallback H.264 sem que dois
// navegadores reconfigurem o mesmo path um por cima do outro.
// Perfis com `-audio` preservam o vídeo do perfil base, mas normalizam apenas
// a trilha de áudio em Opus. Assim uma grade mutada não abre FFmpeg por tile.
export type LiveViewMode = 'grid' | 'grid-audio' | 'grid-hevc' | 'original' | 'original-audio';

// TILE DE MOSAICO NÃO É TELA CHEIA — e o bitrate é o que chega no espectador.
//
// O tile ocupa ~300×200 px na tela; entregar 1280×720 a 1800 kbps era mandar
// resolução que o navegador joga fora no downscale e bitrate que ele não
// consegue engolir. Com 21 tiles isso são ~38 Mbps DE DESCIDA para o cliente.
// MEDIDO no MediaMTX quando o link não dá conta: "reader is too slow,
// discarding 216 frames" — o servidor descarta quadros porque o navegador não
// consome. O operador vê exatamente o que foi relatado: fps despencando,
// tela congelando e o player reconectando "infinitamente".
//
// 640×360 já é mais do que o tile mostra, e 700 kbps sustenta essa resolução
// com folga em H.264. A conta do mosaico cai de ~38 Mbps para ~15 Mbps, e
// quem abre uma câmera em tela cheia continua recebendo o perfil grande
// (`original`), que não passa por aqui.
// FLUIDEZ x BANDA: por que o FPS voltou a 20 e a resolução NÃO.
//
// A redução acima foi feita quando o mosaico congelava. Só que a congestão
// tinha outra causa, corrigida depois: cada tile abria até 4 sessões WebRTC da
// MESMA câmera (ver "sessão WebRTC órfã"), multiplicando a descida por 4. Com
// aquilo de pé, nenhum valor aqui seria suficiente; com aquilo resolvido, o
// orçamento sobrou.
//
// O operador percebe FLUIDEZ, não pixel: num tile de ~300×200 a diferença
// entre 640 e 1280 de largura é invisível (o navegador descarta no downscale),
// mas 15 fps contra 20 aparece como movimento "picotado". FPS também é o
// parâmetro mais BARATO em banda — subir 15→20 pede ~1/3 a mais de bitrate na
// mesma resolução, enquanto dobrar a largura pediria ~4×.
//
// Daí a escolha: devolve os 20 fps (o que foi notado em produção), mantém
// 640×360 (o que de fato cortou os ~38 Mbps para o navegador) e acompanha o
// bitrate para sustentar a taxa. Mosaico de 21 tiles ≈ 19 Mbps — metade do
// que causava o "reader is too slow", com a fluidez de volta.
//
// Tudo ajustável sem deploy: se o link de algum cliente não aguentar, baixe
// GRID_LIVE_TARGET_FPS/GRID_LIVE_BITRATE_KBPS por env em vez de editar código.
export const GRID_LIVE_MAX_WIDTH = envNumber('GRID_LIVE_MAX_WIDTH', 640, {
  min: 320, max: 1920, integer: true,
});
export const GRID_LIVE_MAX_HEIGHT = envNumber('GRID_LIVE_MAX_HEIGHT', 360, {
  min: 180, max: 1080, integer: true,
});
export const GRID_LIVE_TARGET_FPS = envNumber('GRID_LIVE_TARGET_FPS', 20, {
  min: 5, max: 30, integer: true,
});
/** Bitrate do tile de mosaico, em kbps. Ver comentário acima. */
export const GRID_LIVE_BITRATE_KBPS = envNumber('GRID_LIVE_BITRATE_KBPS', 900, {
  min: 200, max: 8000, integer: true,
});
export const INSTANT_LIVE_MIN_BITRATE_KBPS = envNumber('INSTANT_LIVE_MIN_BITRATE_KBPS', 400, {
  min: 200, max: 2000, integer: true,
});
export const INSTANT_LIVE_MAX_BITRATE_KBPS = envNumber('INSTANT_LIVE_MAX_BITRATE_KBPS', 700, {
  min: 300, max: 2000, integer: true,
});

/**
 * Orçamento do modo Instantâneo.
 *
 * Um teto fixo não basta: uma câmera VBR pode reduzir o original durante uma
 * cena parada e tornar um encode leve de taxa fixa maior que o Full HD. Quando
 * conhecemos a taxa da fonte, reduzimos pela raiz da proporção de pixels (uma
 * aproximação conservadora para H.264). A telemetria instantânea da câmera pode
 * despencar em cenas paradas; por isso ela nunca reduz o encode abaixo do piso
 * visual seguro. Sem telemetria da fonte usamos 600 kbps.
 */
export function resolveInstantBitrateKbps(input: {
  sourceBitrateKbps?: number | null;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
  outputWidth?: number;
  outputHeight?: number;
  ceilingKbps?: number;
}) {
  const ceiling = Math.max(64, Math.round(Number(input.ceilingKbps) || INSTANT_LIVE_MAX_BITRATE_KBPS));
  const sourceBitrate = Number(input.sourceBitrateKbps);
  if (!Number.isFinite(sourceBitrate) || sourceBitrate <= 0) {
    return Math.min(600, ceiling);
  }

  const sourcePixels = Number(input.sourceWidth) * Number(input.sourceHeight);
  const outputPixels = Number(input.outputWidth ?? GRID_LIVE_MAX_WIDTH)
    * Number(input.outputHeight ?? GRID_LIVE_MAX_HEIGHT);
  const pixelFactor = Number.isFinite(sourcePixels) && sourcePixels > 0
    && Number.isFinite(outputPixels) && outputPixels > 0
    ? Math.min(0.65, Math.max(0.2, Math.sqrt(Math.min(1, outputPixels / sourcePixels))))
    : 0.5;
  const proportional = Math.floor(sourceBitrate * pixelFactor);
  const belowOriginal = Math.floor(sourceBitrate * 0.7);

  // Não tente ser menor que um original já comprimido demais sacrificando a
  // imagem: 95 kbps em 640×360 @20 produziu macroblocos severos em produção.
  // Nessa situação rara a qualidade mínima vence a economia de banda.
  const minimum = Math.min(INSTANT_LIVE_MIN_BITRATE_KBPS, ceiling);
  return Math.min(ceiling, Math.max(minimum, Math.min(proportional, belowOriginal)));
}

export function normalizeLiveViewMode(value?: string | null): LiveViewMode {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'grid') return 'grid';
  if (v === 'grid-audio') return 'grid-audio';
  if (v === 'grid-hevc') return 'grid-hevc';
  if (v === 'original') return 'original';
  if (v === 'original-audio') return 'original-audio';
  return 'original';
}

export function resolveGridLiveProfile(input?: {
  detectedWidth?: number | null;
  detectedHeight?: number | null;
  streamWidth?: number | null;
  streamHeight?: number | null;
}) {
  const widthCandidate = input?.detectedWidth ?? input?.streamWidth ?? GRID_LIVE_MAX_WIDTH;
  const heightCandidate = input?.detectedHeight ?? input?.streamHeight ?? GRID_LIVE_MAX_HEIGHT;

  return {
    width: Math.max(1, Math.min(GRID_LIVE_MAX_WIDTH, Number(widthCandidate) || GRID_LIVE_MAX_WIDTH)),
    height: Math.max(1, Math.min(GRID_LIVE_MAX_HEIGHT, Number(heightCandidate) || GRID_LIVE_MAX_HEIGHT)),
    fps: GRID_LIVE_TARGET_FPS,
  };
}
