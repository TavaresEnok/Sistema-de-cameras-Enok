import assert from 'node:assert/strict';
import test from 'node:test';
import { duracaoDaVolta, paradaNoInstante, proximaParada } from '../src/lib/ronda-rotacao.ts';

// A regra existe nos DOIS lados de propósito (servidor e navegador): a tela
// precisa saber em que parada está sem perguntar ao servidor a cada segundo.
// Estes testes fixam que as duas cópias concordam.

const paradas = [
  { layoutId: 'portao', segundos: 60 },
  { layoutId: 'corredor', segundos: 15 },
  { layoutId: 'garagem', segundos: 30 },
];

test('a volta soma os tempos de cada parada', () => {
  assert.equal(duracaoDaVolta(paradas), 105);
  assert.equal(duracaoDaVolta([]), 0);
});

test('a posição vem do TEMPO decorrido', () => {
  // Aba em segundo plano tem o temporizador estrangulado pelo navegador.
  // Contar trocas faria o mural voltar atrasado — mostrando o corredor quando o
  // operador espera o portão.
  assert.deepEqual(paradaNoInstante(paradas, 0), { indice: 0, segundosNaParada: 0 });
  assert.deepEqual(paradaNoInstante(paradas, 59), { indice: 0, segundosNaParada: 59 });
  assert.deepEqual(paradaNoInstante(paradas, 60), { indice: 1, segundosNaParada: 0 });
  assert.deepEqual(paradaNoInstante(paradas, 80), { indice: 2, segundosNaParada: 5 });
});

test('depois de uma volta inteira, recomeça', () => {
  assert.deepEqual(paradaNoInstante(paradas, 105), { indice: 0, segundosNaParada: 0 });
  assert.deepEqual(paradaNoInstante(paradas, 110), { indice: 0, segundosNaParada: 5 });
});

test('a ronda dá a volta e nunca aponta para o vazio', () => {
  assert.equal(proximaParada(0, 3), 1);
  assert.equal(proximaParada(2, 3), 0);
  assert.equal(proximaParada(99, 3), 1);
  assert.equal(proximaParada(0, 0), 0);
});

test('tempo estranho não trava o mural', () => {
  // Relógio da máquina mexido, aba dormindo muito tempo, número quebrado: o
  // mural precisa continuar rodando, nunca travar numa imagem parada.
  assert.equal(paradaNoInstante(paradas, NaN).indice, 0);
  assert.ok(paradaNoInstante(paradas, -50).indice >= 0);
  assert.equal(paradaNoInstante([], 30).indice, 0);
});
