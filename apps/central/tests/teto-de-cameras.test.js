'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarTeto, tetoParaHeartbeat } = require('../src/teto-de-cameras');

// "preciso definir quantidade de camera que aquela instalação suporta"
// (dono, 24/08/2026)

test('A ARMADILHA: campo VAZIO é "sem teto", nunca teto zero', () => {
  // Number('') devolve 0 em JavaScript. Sem esta guarda, um campo em branco
  // travaria todo cadastro de câmera do cliente.
  for (const vazio of ['', '   ', null, undefined]) {
    const r = normalizarTeto(vazio);
    assert.equal(r.ok, true);
    assert.equal(r.valor, null, `"${vazio}" deveria virar SEM teto`);
  }
});

test('zero escrito à mão é teto de verdade', () => {
  assert.deepEqual(normalizarTeto('0'), { ok: true, valor: 0 });
  assert.deepEqual(normalizarTeto(0), { ok: true, valor: 0 });
});

test('o caso real: 50 câmeras contratadas', () => {
  assert.deepEqual(normalizarTeto('50'), { ok: true, valor: 50 });
  assert.deepEqual(normalizarTeto(50), { ok: true, valor: 50 });
});

test('decimal é truncado, não arredondado para cima', () => {
  // 50,9 vira 50: cobrar por meia câmera não existe, e arredondar para cima
  // entregaria uma câmera que ninguém pagou.
  assert.equal(normalizarTeto('50.9').valor, 50);
});

test('texto e negativo são RECUSADOS, não viram número estranho', () => {
  for (const ruim of ['cinquenta', '-1', 'NaN', '1e', '10 câmeras']) {
    assert.equal(normalizarTeto(ruim).ok, false, `"${ruim}" deveria ser recusado`);
  }
});

test('o heartbeat leva null quando não há teto', () => {
  assert.equal(tetoParaHeartbeat(undefined), null);
  assert.equal(tetoParaHeartbeat(null), null);
  assert.equal(tetoParaHeartbeat(''), null);
  assert.equal(tetoParaHeartbeat('abc'), null);
  assert.equal(tetoParaHeartbeat(50), 50);
  assert.equal(tetoParaHeartbeat('50'), 50);
});
