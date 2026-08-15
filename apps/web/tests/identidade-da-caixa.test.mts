import assert from 'node:assert/strict';
import test from 'node:test';
import { chaveDaCaixa, mesmoElemento } from '../src/lib/identidade-da-caixa.ts';

// ─────────────────────────────────────────────────────────────────────────────
// "o triangulo consegue acompanhar melhor do que o quadrado que fica sumindo
//  muito" (dono, 14/08/2026)
//
// A chave era `detection.id`, que carrega carimbo de tempo e índice — id novo a
// cada amostra, elemento destruído e recriado, transição CSS sem passado para
// animar. Piscar puro de renderização.
// ─────────────────────────────────────────────────────────────────────────────

const CAM = 'cam-07';

test('duas amostras do mesmo rastro reaproveitam o elemento', () => {
  // É o defeito: ids diferentes, mesma pessoa. Antes virava caixa nova.
  const t0 = { id: 'cam-07-1786759477152-0', trackId: 200195 };
  const t1 = { id: 'cam-07-1786759477277-0', trackId: 200195 };
  assert.equal(mesmoElemento(CAM, t0, t1), true);
});

test('rastros diferentes são elementos diferentes', () => {
  assert.equal(mesmoElemento(CAM, { id: 'a', trackId: 1 }, { id: 'b', trackId: 2 }), false);
});

test('trackId ZERO é identidade válida — `||` quebraria justo essa', () => {
  // `trackId || id` devolveria o id quando o rastro é 0, e aquela caixa
  // voltaria a piscar. O rastreador numera a partir de zero.
  const a = { id: 'x-1', trackId: 0 };
  const b = { id: 'x-2', trackId: 0 };
  assert.equal(mesmoElemento(CAM, a, b), true);
  assert.match(chaveDaCaixa(CAM, a), /track-0$/);
});

test('sem rastreio (rosto) cada detecção segue sendo nova', () => {
  // Não há como afirmar que são o mesmo objeto; o comportamento antigo é o
  // honesto aqui.
  const a = { id: 'face-1' };
  const b = { id: 'face-2' };
  assert.equal(mesmoElemento(CAM, a, b), false);
  assert.match(chaveDaCaixa(CAM, a), /det-face-1$/);
});

test('trackId nulo ou indefinido cai no id, sem quebrar', () => {
  for (const trackId of [null, undefined]) {
    assert.match(chaveDaCaixa(CAM, { id: 'z', trackId }), /det-z$/);
  }
});

test('trackId inválido não vira chave', () => {
  // NaN entrando como chave produziria "track-NaN" para objetos distintos —
  // duas pessoas colapsariam numa caixa só.
  assert.match(chaveDaCaixa(CAM, { id: 'w', trackId: Number.NaN }), /det-w$/);
});

test('o mesmo número de rastro em câmeras diferentes NÃO colide', () => {
  // No mosaico, dois equipamentos numeram rastros a partir de 1. Sem o prefixo
  // por câmera, a pessoa de uma câmera herdaria a posição da outra.
  assert.notEqual(
    chaveDaCaixa('cam-07', { id: 'a', trackId: 1 }),
    chaveDaCaixa('cam-09', { id: 'b', trackId: 1 }),
  );
});
