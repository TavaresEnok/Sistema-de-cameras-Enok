import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gridFollowsCameraProfile,
  parseGridSourcePolicy,
} from '../src/camera-stream/helpers/live-delivery-profile.helper';

// Incidente Vibe 15/09/2026: a câmera marcada "Original da câmera" aparecia na
// grade com tarja, porque a grade ignorava o cadastro e usava o stream 2 (4:3).

test('política da grade: só "camera" liga; qualquer outro valor mantém o padrão leve', () => {
  assert.equal(parseGridSourcePolicy('camera'), 'camera');
  assert.equal(parseGridSourcePolicy('  CAMERA '), 'camera');
  assert.equal(parseGridSourcePolicy(undefined), 'sub');
  assert.equal(parseGridSourcePolicy(''), 'sub');
  assert.equal(parseGridSourcePolicy('main'), 'sub', 'valor desconhecido nunca muda a frota por engano');
});

test('com "camera", a grade segue o cadastro e o Instantâneo continua no stream 2', () => {
  assert.equal(gridFollowsCameraProfile('grid', 'camera'), true);
  assert.equal(gridFollowsCameraProfile('grid-hevc', 'camera'), true);
  assert.equal(gridFollowsCameraProfile('grid-audio', 'camera'), false, 'Instantâneo é sempre o stream 2');
  assert.equal(gridFollowsCameraProfile('original', 'camera'), false);
});

test('com o padrão "sub", nada muda para nenhum modo', () => {
  for (const mode of ['grid', 'grid-hevc', 'grid-audio', 'original', 'original-audio'] as const) {
    assert.equal(gridFollowsCameraProfile(mode, 'sub'), false, mode);
  }
});
