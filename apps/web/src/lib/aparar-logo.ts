/**
 * APARAR A MARGEM TRANSPARENTE de um logo antes de guardá-lo.
 *
 * 24/08/2026, instalação Córtex: "coloquei as imagem lá mas no login ficou muito
 * ruim, muito ruim". O arquivo enviado tinha 1448×1086, mas a palavra CÓRTEX
 * ocupava só 1269×371 — o resto era transparência.
 *
 * A caixa do login limita a ALTURA (44px). Com a moldura vazia entrando na
 * conta, a imagem inteira desenhava a 59×44 e a palavra sobrava com 51×15 px:
 * ilegível. Aparada, a mesma arte desenha a 150×44 — três vezes maior, sem que
 * ninguém precise reeditar o arquivo.
 *
 * Exportar logo com margem generosa é o comportamento NORMAL de quem faz arte;
 * quem tem de se adaptar é o sistema, não o cliente.
 *
 * Funções puras: a matemática toda é testável sem navegador nem canvas.
 */

export type Caixa = { x: number; y: number; largura: number; altura: number };

/**
 * Menor retângulo que contém os pixels visíveis.
 *
 * `dados` é o array RGBA do canvas (4 bytes por pixel). `limiar` ignora o
 * anti-serrilhado quase invisível — sem ele, um halo de alfa 1 ao redor da arte
 * faria a "aparagem" não aparar nada, que foi o caso deste arquivo: a moldura
 * externa tinha alfa entre 1 e 15.
 *
 * Devolve null quando a imagem é inteiramente transparente (nada a mostrar).
 */
export function caixaDoConteudo(
  dados: Uint8ClampedArray | number[],
  largura: number,
  altura: number,
  limiar = 16,
): Caixa | null {
  if (largura <= 0 || altura <= 0) return null;
  let minX = largura;
  let minY = altura;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      const alfa = dados[(y * largura + x) * 4 + 3] ?? 0;
      if (alfa <= limiar) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, largura: maxX - minX + 1, altura: maxY - minY + 1 };
}

/**
 * Vale a pena aparar?
 *
 * Aparar 2 pixels de sobra não muda nada na tela e só gasta processamento. O
 * corte só compensa quando a moldura vazia é grande o bastante para encolher a
 * arte de verdade — e é a ALTURA que manda, porque é ela que a caixa do login
 * limita.
 */
export function valeAparar(caixa: Caixa | null, largura: number, altura: number): boolean {
  if (!caixa) return false;
  if (caixa.largura <= 0 || caixa.altura <= 0) return false;
  // 8%: abaixo disso a arte cresceria menos de um décimo ao ser aparada, o que
  // ninguém enxerga. O arquivo que motivou isto tinha 66% de sobra na altura.
  const sobraLargura = 1 - caixa.largura / largura;
  const sobraAltura = 1 - caixa.altura / altura;
  return sobraLargura >= 0.08 || sobraAltura >= 0.08;
}

/**
 * Uma folga proporcional devolvida em volta da arte aparada.
 *
 * Cortar rente encosta a letra na borda da moldura do login. 2% da maior
 * dimensão devolve o respiro sem trazer de volta o problema.
 */
export function comFolga(caixa: Caixa, largura: number, altura: number, proporcao = 0.02): Caixa {
  const folga = Math.round(Math.max(caixa.largura, caixa.altura) * proporcao);
  const x = Math.max(0, caixa.x - folga);
  const y = Math.max(0, caixa.y - folga);
  return {
    x,
    y,
    largura: Math.min(largura - x, caixa.largura + folga * 2),
    altura: Math.min(altura - y, caixa.altura + folga * 2),
  };
}
