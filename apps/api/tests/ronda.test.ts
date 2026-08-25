import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PARADAS,
  MAX_SEGUNDOS,
  MIN_SEGUNDOS,
  SEGUNDOS_PADRAO,
  duracaoDaVolta,
  paradaNoInstante,
  proximaParada,
  validarParadas,
} from '../src/rondas/helpers/ronda.helper';

// "você cria uma grid, seleciona quantas quiser, e essas grids abrem um mural
//  que passa a cada minuto ou segundo que você definir POR GRID"
//  (dono, 25/08/2026)

const conhecidos = new Set(['a', 'b', 'c']);

test('O CASO REAL: três mosaicos com tempos diferentes', () => {
  const r = validarParadas(
    [{ layoutId: 'a', segundos: 60 }, { layoutId: 'b', segundos: 15 }, { layoutId: 'c', segundos: 30 }],
    conhecidos,
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.paradas.map((p) => p.segundos), [60, 15, 30]);
  assert.equal(duracaoDaVolta(r.ok ? r.paradas : []), 105);
});

test('mosaico APAGADO não pode ficar na ronda', () => {
  // Senão o mural mostra tela preta no meio da volta e ninguém entende por quê.
  const r = validarParadas([{ layoutId: 'sumiu', segundos: 30 }], conhecidos);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.motivo, 'layout-invalido');
});

test('tempo AUSENTE vira o padrão, nunca zero', () => {
  // `Number(null)` devolve 0 em JavaScript. Sem guarda, o mosaico passaria
  // voando e a ronda pareceria quebrada.
  for (const vazio of [null, undefined, '']) {
    const r = validarParadas([{ layoutId: 'a', segundos: vazio as unknown as number }], conhecidos);
    assert.equal(r.ok && r.paradas[0].segundos, SEGUNDOS_PADRAO, `"${String(vazio)}"`);
  }
});

test('tempo tem piso e teto', () => {
  const curto = validarParadas([{ layoutId: 'a', segundos: 1 }], conhecidos);
  assert.equal(curto.ok && curto.paradas[0].segundos, MIN_SEGUNDOS, 'piso: menos que isso a tela piscaria em vão');
  const longo = validarParadas([{ layoutId: 'a', segundos: 99999 }], conhecidos);
  assert.equal(longo.ok && longo.paradas[0].segundos, MAX_SEGUNDOS, 'teto: mais que isso não é ronda, é mosaico fixo');
});

test('o MESMO mosaico duas vezes seguidas é recusado', () => {
  // Não troca nada na tela: o operador vê a imagem parada pelo dobro do tempo
  // e conclui que a ronda travou.
  const r = validarParadas([{ layoutId: 'a', segundos: 30 }, { layoutId: 'a', segundos: 30 }], conhecidos);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.motivo, 'layout-repetido-em-sequencia');
});

test('o mesmo mosaico pode repetir SEPARADO — a→b→a é ronda válida', () => {
  const r = validarParadas(
    [{ layoutId: 'a', segundos: 30 }, { layoutId: 'b', segundos: 30 }, { layoutId: 'a', segundos: 30 }],
    conhecidos,
  );
  assert.equal(r.ok, true);
});

test('ronda vazia e ronda gigante são recusadas', () => {
  assert.equal(validarParadas([], conhecidos).ok, false);
  assert.equal(validarParadas(null, conhecidos).ok, false);
  const gigante = Array.from({ length: MAX_PARADAS + 1 }, (_, i) => ({ layoutId: i % 2 ? 'a' : 'b', segundos: 30 }));
  const r = validarParadas(gigante, conhecidos);
  assert.equal(r.ok === false && r.motivo, 'paradas-demais');
});

test('a ronda DÁ A VOLTA, não termina', () => {
  assert.equal(proximaParada(0, 3), 1);
  assert.equal(proximaParada(2, 3), 0);
  assert.equal(proximaParada(0, 0), 0, 'lista vazia não estoura');
  assert.equal(proximaParada(99, 3), 1, 'índice fora da lista não aponta para o vazio');
});

test('recarregar a página não perde a volta', () => {
  // Sem isto, recarregar volta ao começo e o operador refaz o caminho.
  const paradas = [{ layoutId: 'a', segundos: 10 }, { layoutId: 'b', segundos: 20 }, { layoutId: 'c', segundos: 30 }];
  assert.deepEqual(paradaNoInstante(paradas, 0), { indice: 0, segundosNaParada: 0 });
  assert.deepEqual(paradaNoInstante(paradas, 15), { indice: 1, segundosNaParada: 5 });
  assert.deepEqual(paradaNoInstante(paradas, 35), { indice: 2, segundosNaParada: 5 });
  // Passou uma volta inteira (10+20+30 = 60s) e recomeçou: aos 65s estamos 5
  // segundos dentro da PRIMEIRA parada da volta seguinte.
  assert.deepEqual(paradaNoInstante(paradas, 65), { indice: 0, segundosNaParada: 5 });
  // E exatamente no fecho da volta, de volta ao começo.
  assert.deepEqual(paradaNoInstante(paradas, 60), { indice: 0, segundosNaParada: 0 });
});

test('tempo negativo ou estranho não quebra a posição', () => {
  const paradas = [{ layoutId: 'a', segundos: 10 }, { layoutId: 'b', segundos: 10 }];
  assert.equal(paradaNoInstante(paradas, -5).indice >= 0, true);
  assert.equal(paradaNoInstante(paradas, NaN).indice, 0);
  assert.deepEqual(paradaNoInstante([], 30), { indice: 0, segundosNaParada: 0 });
});
