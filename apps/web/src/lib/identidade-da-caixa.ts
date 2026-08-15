/**
 * A IDENTIDADE VISUAL da caixa de detecção.
 *
 * Relatado em 14/08/2026: "o triangulo consegue acompanhar melhor do que o
 * quadrado que fica sumindo muito".
 *
 * A causa é de renderização, não de visão computacional. A chave do elemento
 * era `detection.id`, que carrega carimbo de tempo e índice:
 *
 *     0c50495c-…-1786759477152-0
 *                ^^^^^^^^^^^^^ ^
 *                tempo         índice no quadro
 *
 * Cada amostra produz um id novo, então o navegador DESTRÓI o retângulo e cria
 * outro no lugar. Elemento recriado não tem passado: transição CSS não anima,
 * e o resultado é piscar. A câmera do cliente não pisca porque desenha o mesmo
 * marcador em todo quadro, no chip dela.
 *
 * Com o `trackId` do rastreador como chave, é o MESMO elemento se movendo — e
 * aí a animação entre amostras finalmente funciona.
 */

export type DeteccaoIdentificavel = {
  id: string;
  /** Identificador do rastreador. Ausente em detecção sem rastreio (rosto). */
  trackId?: number | null;
};

/**
 * Chave estável para o elemento na tela.
 *
 * NUNCA usar `trackId || id`: o rastreador pode emitir **zero** como
 * identificador válido, e `0 || x` devolve `x` — a caixa daquele objeto
 * voltaria a piscar, justamente a que o conserto deveria salvar. A comparação
 * é explícita contra null/undefined.
 *
 * O prefixo por câmera evita colisão no mosaico: dois equipamentos numerando
 * rastros a partir de 1 são coisas diferentes na mesma tela.
 */
export function chaveDaCaixa(cameraId: string, deteccao: DeteccaoIdentificavel): string {
  if (deteccao.trackId !== null && deteccao.trackId !== undefined && Number.isFinite(deteccao.trackId)) {
    return `${cameraId}:track-${deteccao.trackId}`;
  }
  // Sem rastreio (rosto, ou detector que não numera) o comportamento antigo é o
  // certo: cada detecção é uma coisa nova, porque não há como afirmar o
  // contrário.
  return `${cameraId}:det-${deteccao.id}`;
}

/**
 * Duas amostras diferentes do MESMO objeto devem reaproveitar o elemento?
 *
 * Existe para o teste declarar a intenção — é a pergunta que o defeito
 * respondia errado.
 */
export function mesmoElemento(
  cameraId: string,
  a: DeteccaoIdentificavel,
  b: DeteccaoIdentificavel,
): boolean {
  return chaveDaCaixa(cameraId, a) === chaveDaCaixa(cameraId, b);
}
