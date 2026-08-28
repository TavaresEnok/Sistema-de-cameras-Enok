export type FonteParaBitrate = {
  bitrateKbps?: number | null;
  largura?: number | null;
  altura?: number | null;
};

const BITRATE_MINIMO_KBPS = 800;
const BITRATE_MAXIMO_KBPS = 6000;
// H.264 precisa de mais bits que H.265 para conservar qualidade semelhante.
// 50% é uma margem prática; o antigo valor fixo de 6 Mbps triplicava fontes
// HEVC de aproximadamente 1,9 Mbps sem olhar a câmera.
const MARGEM_HEVC_PARA_H264 = 1.5;

const limitar = (valor: number, minimo: number, maximo: number) =>
  Math.min(maximo, Math.max(minimo, valor));

/**
 * Bitrate do fallback H.264 da câmera individual.
 *
 * A fonte medida sempre vence. A resolução só serve de fallback para câmeras
 * cujo RTSP/RTMP não informa bitrate; assim uma 1080p de 1,9 Mbps não vira
 * 6 Mbps apenas por ter 1920x1080.
 */
export function calcularBitrateH264Compativel(fonte: FonteParaBitrate): number {
  const medido = Number(fonte.bitrateKbps);
  if (Number.isFinite(medido) && medido > 0) {
    const comMargem = medido * MARGEM_HEVC_PARA_H264;
    return limitar(Math.round(comMargem / 100) * 100, BITRATE_MINIMO_KBPS, BITRATE_MAXIMO_KBPS);
  }

  const largura = Number(fonte.largura) || 0;
  const altura = Number(fonte.altura) || 0;
  const pixels = largura * altura;
  if (pixels >= 3840 * 2160) return BITRATE_MAXIMO_KBPS;
  if (pixels >= 1920 * 1080) return 3500;
  if (pixels >= 1280 * 720) return 2500;
  return 1500;
}

