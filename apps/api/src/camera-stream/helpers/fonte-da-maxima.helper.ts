/**
 * MÁXIMA QUALIDADE sem abrir uma segunda conexão na câmera.
 *
 * Relatado em 14/08/2026: "quando mudo também do instantâneo ou equilibrado
 * para máximo fica tudo preto sem vídeo".
 *
 * Medido no equipamento do cliente. Cada modo é um caminho PRÓPRIO no servidor
 * de mídia, e as origens são diferentes:
 *
 *   Instantâneo (_grid) ....... source: publisher   (nosso ffmpeg)
 *   Equilibrado (base) ........ source: publisher   (nosso ffmpeg)
 *   Máxima      (_orig) ....... source: rtsp://…@168.194.15.82:8554/…  ← a CÂMERA
 *
 * Ou seja: escolher Máxima manda o servidor de mídia discar de novo para a
 * câmera, em paralelo com o ffmpeg que já está puxando. A Mercusys aceita UMA
 * sessão RTSP — recusa a segunda com "Operation not permitted", não chega byte
 * nenhum, e o player mostra preto. É a mesma raiz do falso "offline".
 *
 * É o princípio que o Frigate documenta como "reduce the number of connections
 * to your camera": um único puxador, N consumidores, todos lendo do restream
 * (docs/docs/guides/configuring_go2rtc.md e configuration/restream).
 *
 * Aqui a regra é: se a câmera JÁ está publicando para nós, a Máxima lê dessa
 * publicação em vez de discar de novo. Só disca quando não há nada aberto — aí
 * a conexão dela é a única, e é legítima.
 */

export type DecisaoDeFonte = {
  /** A URL que o caminho de Máxima deve usar como origem. */
  url: string;
  /** Chave estável para log e teste. */
  motivo: 'sem-fonte-aberta' | 'reaproveita-publicacao' | 'camera-aceita-segunda-sessao';
  /**
   * A entrega é o stream original da câmera, byte a byte?
   *
   * Falso quando reaproveitamos uma publicação que passou por conversão — o
   * vídeo aparece (que é o ponto), mas chamar isso de "máxima" seria mentir
   * para quem escolheu o modo.
   */
  fidelidadeOriginal: boolean;
};

export type ContextoDaMaxima = {
  /** URL RTSP da própria câmera. */
  urlDaCamera: string;
  /** URL interna do caminho que já está publicando esta câmera, se houver. */
  urlDaPublicacao?: string | null;
  /** Há alguém publicando esta câmera para nós agora? */
  publicacaoAoVivo: boolean;
  /** Essa publicação é cópia crua da câmera (sem conversão)? */
  publicacaoEhCopiaCrua: boolean;
  /**
   * A câmera aceitou uma segunda sessão quando testada?
   *
   * `null` = não foi possível saber. Nesse caso NÃO arriscamos a segunda
   * conexão: preto é o pior resultado possível para quem só quer ver a imagem,
   * e reaproveitar sempre mostra algo.
   */
  aceitaSegundaSessao?: boolean | null;
};

export function decidirFonteDaMaxima(ctx: ContextoDaMaxima): DecisaoDeFonte {
  const publicacao = ctx.urlDaPublicacao?.trim();

  // Nada aberto: a conexão da Máxima será a única. É o caso de sempre e o
  // caminho que entrega o original de verdade.
  if (!ctx.publicacaoAoVivo || !publicacao) {
    return { url: ctx.urlDaCamera, motivo: 'sem-fonte-aberta', fidelidadeOriginal: true };
  }

  // Há publicação aberta E a câmera comprovadamente aceita mais uma sessão:
  // vale discar, porque só assim a Máxima é realmente o original quando a
  // publicação atual passa por conversão.
  if (ctx.aceitaSegundaSessao === true) {
    return { url: ctx.urlDaCamera, motivo: 'camera-aceita-segunda-sessao', fidelidadeOriginal: true };
  }

  // Câmera de sessão única (ou desconhecida): lê do que já está aberto.
  return {
    url: publicacao,
    motivo: 'reaproveita-publicacao',
    // Só é o original quando a publicação é cópia crua. Se ela converte, o
    // usuário vê imagem — e o rótulo não pode prometer qualidade máxima.
    fidelidadeOriginal: ctx.publicacaoEhCopiaCrua,
  };
}
