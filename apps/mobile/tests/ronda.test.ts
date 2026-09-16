import test from 'node:test';
import assert from 'node:assert/strict';
import {
  camerasDaParada,
  duracaoDaVolta,
  paradasUteis,
  proximaParada,
  rondasDoCelular,
  segundosDaParada,
  MIN_SEGUNDOS,
  MAX_SEGUNDOS,
  SEGUNDOS_PADRAO,
  type MosaicoDoApp,
  type RondaDoApp,
} from '../src/utils/ronda';

// O servidor já marcava rondas com `showOnMobile` e o app não lia nada disso.
// Estes testes fixam a regra do que aparece no celular e por quanto tempo.

const MOSAICOS: MosaicoDoApp[] = [
  { id: 'm1', name: 'Portaria', cameraIds: ['cam-a', null, 'cam-b', 'cam-a'] },
  { id: 'm2', name: 'Pátio', cameraIds: ['cam-c'] },
  { id: 'm3', name: 'Vazio', cameraIds: [null, null] },
];
const TODAS = ['cam-a', 'cam-b', 'cam-c'];

function ronda(extra: Partial<RondaDoApp> = {}): RondaDoApp {
  return {
    id: 'r1',
    name: 'Ronda noturna',
    paradas: [{ layoutId: 'm1', segundos: 20 }, { layoutId: 'm2', segundos: 45 }],
    active: true,
    showOnMobile: true,
    ...extra,
  };
}

test('tempo da parada respeita os mesmos limites do servidor', () => {
  assert.equal(segundosDaParada({ segundos: 20 }), 20);
  assert.equal(segundosDaParada({ segundos: 1 }), MIN_SEGUNDOS, 'abaixo do mínimo a tela só piscaria');
  assert.equal(segundosDaParada({ segundos: 99999 }), MAX_SEGUNDOS);
  assert.equal(segundosDaParada({ segundos: 12.6 }), 13, 'arredonda');
});

test('tempo ausente vira o padrão — nunca zero', () => {
  assert.equal(segundosDaParada({}), SEGUNDOS_PADRAO);
  assert.equal(segundosDaParada({ segundos: null }), SEGUNDOS_PADRAO, 'Number(null) é 0: o mosaico passaria voando');
  assert.equal(segundosDaParada({ segundos: '' }), SEGUNDOS_PADRAO);
  assert.equal(segundosDaParada({ segundos: 'abc' }), SEGUNDOS_PADRAO);
  assert.equal(segundosDaParada(null), SEGUNDOS_PADRAO);
});

test('a parada mostra só câmeras visíveis, sem repetir nem contar quadro vazio', () => {
  assert.deepEqual(camerasDaParada({ layoutId: 'm1', segundos: 20 }, MOSAICOS, TODAS), ['cam-a', 'cam-b']);
  assert.deepEqual(
    camerasDaParada({ layoutId: 'm1', segundos: 20 }, MOSAICOS, ['cam-b']),
    ['cam-b'],
    'câmera que o usuário não pode ver não entra',
  );
  assert.deepEqual(camerasDaParada({ layoutId: 'apagado', segundos: 20 }, MOSAICOS, TODAS), []);
});

test('parada sem imagem é pulada — ronda não mostra tela preta', () => {
  const r = ronda({ paradas: [{ layoutId: 'm3', segundos: 10 }, { layoutId: 'm2', segundos: 10 }] });
  assert.deepEqual(paradasUteis(r, MOSAICOS, TODAS).map((p) => p.layoutId), ['m2']);
});

test('só entra na lista do celular a ronda ativa, marcada e com imagem', () => {
  const ok = ronda();
  const inativa = ronda({ id: 'r2', active: false });
  const semMarca = ronda({ id: 'r3', showOnMobile: false });
  const soVazios = ronda({ id: 'r4', paradas: [{ layoutId: 'm3', segundos: 10 }] });
  const semParadas = ronda({ id: 'r5', paradas: [] });

  const lista = rondasDoCelular([ok, inativa, semMarca, soVazios, semParadas], MOSAICOS, TODAS);
  assert.deepEqual(lista.map((r) => r.id), ['r1']);
});

test('usuário que não enxerga nenhuma câmera do mosaico não recebe a ronda', () => {
  assert.deepEqual(rondasDoCelular([ronda()], MOSAICOS, []), []);
});

test('a volta fecha o ciclo e recomeça', () => {
  assert.equal(proximaParada(0, 3), 1);
  assert.equal(proximaParada(2, 3), 0, 'no fim, volta ao começo');
  assert.equal(proximaParada(0, 0), 0, 'sem paradas não quebra');
});

test('duração da volta soma as paradas já normalizadas', () => {
  assert.equal(duracaoDaVolta([{ layoutId: 'm1', segundos: 20 }, { layoutId: 'm2', segundos: 45 }]), 65);
  assert.equal(
    duracaoDaVolta([{ layoutId: 'm1', segundos: 1 } as never, { layoutId: 'm2' } as never]),
    MIN_SEGUNDOS + SEGUNDOS_PADRAO,
    'usa o tempo corrigido, não o cru',
  );
});
