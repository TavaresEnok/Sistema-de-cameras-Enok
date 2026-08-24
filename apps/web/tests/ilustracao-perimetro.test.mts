import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// "quando não tem câmeras cadastradas, não aparece imagem no local onde deveria
//  aparecer" (dono, 24/08/2026) — a tela de Perímetro é inteira sobre a imagem
// da câmera; sem câmera sobrava só texto.

const SVG = readFileSync(join(process.cwd(), 'src/components/IlustracaoPerimetro.tsx'), 'utf8');
const PAGINA = readFileSync(join(process.cwd(), 'src/pages/PerimetroPage.tsx'), 'utf8');

test('a tela sem câmera mostra o exemplo', () => {
  assert.match(PAGINA, /<IlustracaoPerimetro/, 'a ilustração precisa estar na tela vazia');
});

test('o desenho mostra as DUAS coisas que a página configura', () => {
  // Linha de travessia e zona: quem abre pela primeira vez precisa ver o que vai
  // desenhar, senão o texto sozinho não ensina nada.
  assert.match(SVG, /linha de travessia/i);
  assert.match(SVG, /zona/i);
});

test('fica marcado como EXEMPLO — não pode parecer vídeo real', () => {
  // Sem isso, alguém olhando de longe acha que há câmera gravando.
  assert.match(SVG, /EXEMPLO/);
});

test('as cores saem do tema, não são fixas', () => {
  // Cor fixa ignoraria a marca do cliente e quebraria no tema claro.
  assert.match(SVG, /hsl\(var\(--primary/);
  assert.match(SVG, /hsl\(var\(--muted/);
  assert.doesNotMatch(SVG, /#[0-9a-fA-F]{6}/, 'nenhuma cor fixa em hexadecimal');
});

test('tem descrição para leitor de tela', () => {
  assert.match(SVG, /role="img"/);
  assert.match(SVG, /aria-label=/);
});
