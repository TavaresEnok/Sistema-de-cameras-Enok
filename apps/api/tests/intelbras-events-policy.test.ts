import assert from 'node:assert/strict';
import test from 'node:test';
import { devePersistirEventoIntelbras } from '../src/cameras/intelbras-events.service';

test('Intelbras: analíticos proprietários nunca são descartados pelo filtro de movimento', () => {
  for (const tipo of ['LINE_CROSSING', 'PLATE_READ', 'FACE_RECOGNIZED', 'INTRUSION']) {
    assert.equal(devePersistirEventoIntelbras(tipo, 'SYSTEM', false), true, tipo);
  }
});

test('Intelbras: VideoMotion não duplica o detector local em câmeras SYSTEM', () => {
  assert.equal(devePersistirEventoIntelbras('MOTION', 'SYSTEM', true), false);
  assert.equal(devePersistirEventoIntelbras('MOTION', 'SYSTEM', false), false);
});

test('Intelbras: VideoMotion exige opt-in e câmera como fonte do movimento', () => {
  assert.equal(devePersistirEventoIntelbras('MOTION', 'CAMERA', false), false);
  assert.equal(devePersistirEventoIntelbras('MOTION', 'CAMERA', true), true);
});
