/**
 * REENCODAR SEM MUDAR NADA é desperdício — e era o que a grade fazia.
 *
 * "se chegou H.264 deve mostrar H.264 sem conversão porque isso é retrabalho e
 * jogar % da cpu no lixo!!!" (dono, 14/08/2026)
 *
 * Ele está certo, e a medição fecha o caso. O caminho da grade sempre montava
 * argumentos de transcode porque ali o vídeo "é redimensionado". Só que o
 * filtro é `scale=min(iw,640):min(ih,360)` — um teto, não um alvo. Quando a
 * fonte já cabe, o filtro não altera um pixel:
 *
 *   alvo da grade ....... 640×360 @ 20 fps
 *   substream medido .... 640×360 @ 20 fps, H.264   (as 4 câmeras Grupo Flash)
 *
 * Resultado: decodificava, "redimensionava" para o mesmo tamanho e reencodava —
 * gastando CPU e perdendo qualidade para produzir um vídeo idêntico ao que já
 * havia chegado. Pior para a IA que lê desse caminho: ela analisava uma imagem
 * com DUAS compressões em vez do original, e é a nitidez de borda que o
 * detector usa para separar pessoa de fundo.
 *
 * A regra aqui responde a uma pergunta só: o que sai seria diferente do que
 * entrou? Se não for, copie.
 */

export type FonteDeVideo = {
  /** Codec da fonte, como o cadastro conhece ('h264', 'h265'…). */
  codec?: string | null;
  largura?: number | null;
  altura?: number | null;
  fps?: number | null;
};

export type TetoDaEntrega = {
  larguraMaxima: number;
  alturaMaxima: number;
  fpsAlvo: number;
};

export type DecisaoDeCodificacao = {
  copiar: boolean;
  /** Chave estável para log e teste. */
  motivo:
    | 'copia-nada-mudaria'
    | 'codec-incompativel'
    | 'precisa-reduzir-tamanho'
    | 'precisa-reduzir-quadros'
    | 'fonte-desconhecida';
};

/** Só H.264 atravessa sem conversão: é o que todo navegador decodifica. */
function ehH264(codec: string | null | undefined): boolean {
  const c = String(codec ?? '').trim().toLowerCase();
  return c === 'h264' || c === 'avc' || c === 'avc1';
}

/**
 * Copiar o vídeo em vez de reencodar?
 *
 * Sim apenas quando as três condições valem ao mesmo tempo: a fonte já é H.264,
 * já cabe no teto de tamanho e não passa do teto de quadros. Qualquer dúvida
 * — inclusive resolução desconhecida — reencoda, porque o custo de errar para
 * esse lado é CPU, e errar para o outro é entregar um vídeo que o navegador
 * não toca ou que estoura a banda do mosaico.
 *
 * Uma folga deliberada nos quadros: fonte a 20 e teto a 20 copia; fonte a 25
 * com teto 20 reencoda. Sem margem de tolerância, arredondamento de fps
 * relatado pela câmera (19,97) reencodaria à toa.
 */
export function decidirCopiaDeVideo(
  fonte: FonteDeVideo,
  teto: TetoDaEntrega,
): DecisaoDeCodificacao {
  if (!ehH264(fonte.codec)) {
    return { copiar: false, motivo: 'codec-incompativel' };
  }

  const largura = Number(fonte.largura);
  const altura = Number(fonte.altura);
  if (!Number.isFinite(largura) || !Number.isFinite(altura) || largura <= 0 || altura <= 0) {
    // Sem saber o tamanho não dá para afirmar que cabe. Reencodar é o seguro.
    return { copiar: false, motivo: 'fonte-desconhecida' };
  }
  if (largura > teto.larguraMaxima || altura > teto.alturaMaxima) {
    return { copiar: false, motivo: 'precisa-reduzir-tamanho' };
  }

  const fps = Number(fonte.fps);
  // fps ausente não impede a cópia: o tamanho é o que domina o custo do
  // mosaico, e substream costuma vir abaixo do teto de quadros.
  if (Number.isFinite(fps) && fps > teto.fpsAlvo + 1) {
    return { copiar: false, motivo: 'precisa-reduzir-quadros' };
  }

  return { copiar: true, motivo: 'copia-nada-mudaria' };
}
