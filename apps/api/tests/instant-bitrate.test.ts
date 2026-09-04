import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInstantBitrateKbps } from '../src/camera-stream/helpers/live-delivery-profile.helper';

test('Full HD de 1,9 Mbps vira orçamento 360p claramente menor', () => {
  assert.equal(resolveInstantBitrateKbps({
    sourceBitrateKbps: 1900,
    sourceWidth: 1920,
    sourceHeight: 1080,
    outputWidth: 640,
    outputHeight: 360,
    ceilingKbps: 900,
  }), 633);
});

test('Instantâneo nunca recebe orçamento maior ou igual à fonte conhecida', () => {
  for (const sourceBitrateKbps of [100, 500, 900, 1900, 4000]) {
    const result = resolveInstantBitrateKbps({
      sourceBitrateKbps,
      sourceWidth: 1920,
      sourceHeight: 1080,
      outputWidth: 640,
      outputHeight: 360,
      ceilingKbps: 900,
    });
    assert.ok(result < sourceBitrateKbps, `${result} deve ser menor que ${sourceBitrateKbps}`);
  }
});

test('sem telemetria usa orçamento conservador abaixo do teto', () => {
  assert.equal(resolveInstantBitrateKbps({ ceilingKbps: 900 }), 600);
});
