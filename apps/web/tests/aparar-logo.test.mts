import assert from 'node:assert/strict';
import test from 'node:test';
import { caixaDoConteudo, valeAparar, comFolga } from '../src/lib/aparar-logo.ts';

// ─────────────────────────────────────────────────────────────────────────────
// 24/08/2026, Córtex: "coloquei as imagem lá mas no login ficou muito ruim".
//
// O arquivo tinha 1448×1086 e a palavra ocupava 1269×371 — o resto, transparência.
// A caixa do login limita a ALTURA (44px), então a moldura vazia entrava na conta
// e a palavra sobrava com 51×15 px.
// ─────────────────────────────────────────────────────────────────────────────

/** Monta um RGBA com um retângulo opaco dentro de uma tela transparente. */
function tela(largura: number, altura: number, dentro: { x: number; y: number; w: number; h: number }, alfa = 255) {
  const d = new Uint8ClampedArray(largura * altura * 4);
  for (let y = dentro.y; y < dentro.y + dentro.h; y += 1) {
    for (let x = dentro.x; x < dentro.x + dentro.w; x += 1) {
      d[(y * largura + x) * 4 + 3] = alfa;
    }
  }
  return d;
}

test('acha a arte dentro da moldura vazia', () => {
  const d = tela(100, 100, { x: 10, y: 40, w: 80, h: 20 });
  assert.deepEqual(caixaDoConteudo(d, 100, 100), { x: 10, y: 40, largura: 80, altura: 20 });
});

test('o caso real: proporção sai de 1,33 para 3,4', () => {
  // Mesmas proporções do arquivo enviado pelo dono.
  const d = tela(1448, 1086, { x: 90, y: 357, w: 1269, h: 371 });
  const c = caixaDoConteudo(d, 1448, 1086)!;
  assert.equal(c.largura, 1269);
  assert.equal(c.altura, 371);
  // Na caixa do login (210×44) o que manda passa a ser a largura, não o vazio.
  const antes = Math.min(210 / 1448, 44 / 1086);
  const depois = Math.min(210 / 1269, 44 / 371);
  assert.ok(depois > antes * 2.5, 'a arte deve ficar pelo menos 2,5× maior');
});

test('anti-serrilhado quase invisível NÃO conta como conteúdo', () => {
  // O arquivo real tinha um halo de alfa entre 1 e 15 na moldura inteira; sem
  // limiar, a aparagem não aparava nada.
  const d = tela(100, 100, { x: 0, y: 0, w: 100, h: 100 }, 8);
  for (let y = 40; y < 60; y += 1) {
    for (let x = 10; x < 90; x += 1) d[(y * 100 + x) * 4 + 3] = 255;
  }
  assert.deepEqual(caixaDoConteudo(d, 100, 100), { x: 10, y: 40, largura: 80, altura: 20 });
});

test('imagem toda transparente não tem o que aparar', () => {
  assert.equal(caixaDoConteudo(new Uint8ClampedArray(40 * 40 * 4), 40, 40), null);
  assert.equal(valeAparar(null, 40, 40), false);
});

test('logo já justo NÃO é aparado — cortar 2px só gasta processamento', () => {
  const d = tela(100, 50, { x: 1, y: 1, w: 98, h: 48 });
  assert.equal(valeAparar(caixaDoConteudo(d, 100, 50), 100, 50), false);
});

test('moldura grande vale a pena aparar', () => {
  const d = tela(1448, 1086, { x: 90, y: 357, w: 1269, h: 371 });
  assert.equal(valeAparar(caixaDoConteudo(d, 1448, 1086), 1448, 1086), true);
});

test('sobra só na altura já basta — é a altura que a caixa do login limita', () => {
  const d = tela(100, 100, { x: 0, y: 30, w: 100, h: 40 });
  assert.equal(valeAparar(caixaDoConteudo(d, 100, 100), 100, 100), true);
});

test('a folga devolvida nunca sai da imagem', () => {
  const c = comFolga({ x: 0, y: 0, largura: 100, altura: 50 }, 100, 50);
  assert.equal(c.x, 0);
  assert.equal(c.y, 0);
  assert.ok(c.x + c.largura <= 100);
  assert.ok(c.y + c.altura <= 50);
});

test('a folga é proporcional à arte, não fixa', () => {
  const pequena = comFolga({ x: 50, y: 50, largura: 100, altura: 40 }, 500, 500);
  const grande = comFolga({ x: 50, y: 50, largura: 400, altura: 120 }, 900, 500);
  assert.ok(grande.largura - 400 > pequena.largura - 100);
});
