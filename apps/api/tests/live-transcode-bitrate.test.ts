import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calcularBitrateH264Compativel } from '../src/camera-stream/helpers/bitrate-de-transcode.helper';

const mediaMtxService = readFileSync(
  new URL('../src/camera-stream/mediamtx-proxy.service.ts', import.meta.url),
  'utf8',
);

test('fonte H.265 de 1,9 Mbps recebe margem H.264 sem ser inflada para 6 Mbps', () => {
  assert.equal(calcularBitrateH264Compativel({ bitrateKbps: 1900, largura: 1920, altura: 1080 }), 2900);
});

test('bitrate medido vence o chute pela resolução', () => {
  assert.equal(calcularBitrateH264Compativel({ bitrateKbps: 1400, largura: 1920, altura: 1080 }), 2100);
});

test('sem medição usa fallback por resolução e mantém limites seguros', () => {
  assert.equal(calcularBitrateH264Compativel({ largura: 1920, altura: 1080 }), 3500);
  assert.equal(calcularBitrateH264Compativel({ bitrateKbps: 9000, largura: 3840, altura: 2160 }), 6000);
  assert.equal(calcularBitrateH264Compativel({ bitrateKbps: 100 }), 800);
});

test('CPU e GPU usam o bitrate calculado, nunca os antigos 6/5 Mbps fixos', () => {
  assert.ok((mediaMtxService.match(/compatibleH264BitrateKbps/g) ?? []).length >= 7);
  assert.doesNotMatch(mediaMtxService, /-b:v 6000k/);
  assert.doesNotMatch(mediaMtxService, /-b:v 5000k/);
});
