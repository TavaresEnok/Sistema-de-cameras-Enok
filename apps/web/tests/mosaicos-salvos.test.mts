import assert from 'node:assert/strict';
import test from 'node:test';
import { lerMosaicoDaApi, preferirApi, CHAVE_LOCAL } from '../src/lib/mosaicos-salvos.ts';

// "as grids de live/ não está tão bem sincronizadas com rondas" (dono, 25/08/2026)
//
// Havia DUAS listas com o mesmo nome: a que o operador salva (API) e um mosaico
// GERADO chamado "Layout Atual" com todas as câmeras. A Ronda lia a segunda, e
// oferecia um identificador que não existe no banco — o servidor recusaria na
// hora de salvar.

test('a chave local é a MESMA da tela Ao Vivo', () => {
  // Duas chaves seriam duas listas, e o defeito voltaria por outro caminho.
  assert.equal(CHAVE_LOCAL, 'drac.live.layouts.v1');
});

test('mosaico da API é aceito', () => {
  const m = lerMosaicoDaApi({ id: 'abc', name: 'Portaria', gridSize: '2x2', cameraIds: ['c1', 'c2'] });
  assert.equal(m?.id, 'abc');
  assert.deepEqual(m?.cameraIds, ['c1', 'c2']);
});

test('mosaico sem identificador REAL é recusado', () => {
  // Era exatamente o caso do "default-live-layout": id inventado na tela, que
  // o servidor não conhece.
  assert.equal(lerMosaicoDaApi({ name: 'x', gridSize: '2x2', cameraIds: [] }), null);
  assert.equal(lerMosaicoDaApi({ id: '', name: 'x', gridSize: '2x2', cameraIds: [] }), null);
});

test('grade em formato estranho é recusada — a tela não saberia desenhar', () => {
  for (const ruim of ['9x9', 'grande', '2x', '', '2 x 2']) {
    assert.equal(lerMosaicoDaApi({ id: 'a', name: 'x', gridSize: ruim, cameraIds: [] }), null, ruim);
  }
});

test('lista de câmeras ausente é recusada', () => {
  assert.equal(lerMosaicoDaApi({ id: 'a', name: 'x', gridSize: '2x2', cameraIds: 'c1,c2' }), null);
});

test('nome vazio ganha um padrão em vez de sumir da lista', () => {
  assert.equal(lerMosaicoDaApi({ id: 'a', name: '   ', gridSize: '1x1', cameraIds: [] })?.name, 'Mosaico');
});

test('A API MANDA sobre a cópia local', () => {
  // Mosaico apagado em outro aparelho não pode ressuscitar porque ainda estava
  // no armazenamento deste navegador.
  const daApi = [{ id: 'a', name: 'A', gridSize: '2x2', cameraIds: [] }];
  const local = [{ id: 'z', name: 'Z (apagado em outro lugar)', gridSize: '2x2', cameraIds: [] }];
  assert.deepEqual(preferirApi(daApi, local), daApi);
});

test('a cópia local só vale enquanto a API não respondeu', () => {
  const local = [{ id: 'z', name: 'Z', gridSize: '2x2', cameraIds: [] }];
  assert.deepEqual(preferirApi([], local), local);
  assert.deepEqual(preferirApi([], []), []);
});
