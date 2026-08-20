import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLiveProtocolOrder,
  liveProtocolStorageKey,
  shouldUseGridH264Fallback,
  videoCodecFamily,
} from '../src/lib/live-protocol-policy.ts';

test('grade tenta WebRTC primeiro para H.264, H.265 e codec desconhecido', () => {
  for (const codec of ['h264', 'h265', null]) {
    const order = buildLiveProtocolOrder({
      deliveryMode: 'grid-hevc',
      sourceCodec: codec,
      preferred: 'hls',
      learned: 'hls',
      smartOrder: ['hls', 'webrtc'],
      mseDecodesHevc: true,
    });
    assert.equal(order[0], 'webrtc', `codec ${codec ?? 'desconhecido'} não iniciou em WebRTC`);
  }
});

test('memória antiga não desvia a grade diretamente para HLS', () => {
  assert.deepEqual(buildLiveProtocolOrder({
    deliveryMode: 'grid',
    sourceCodec: 'h264',
    preferred: 'hls',
    learned: 'llhls',
    smartOrder: ['hls'],
    mseDecodesHevc: false,
  }), ['webrtc', 'llhls', 'hls']);
});

test('HEVC sem MSE usa WebRTC real e depois contingência H.264', () => {
  assert.deepEqual(buildLiveProtocolOrder({
    deliveryMode: 'grid-hevc',
    sourceCodec: 'hevc',
    mseDecodesHevc: false,
  }), ['webrtc']);
  assert.equal(shouldUseGridH264Fallback('grid-hevc', 'hevc'), true);
});

test('H.264 testa LL-HLS e HLS antes de repetir; não pede transcode equivalente', () => {
  assert.deepEqual(buildLiveProtocolOrder({
    deliveryMode: 'grid-hevc',
    sourceCodec: 'avc1',
    mseDecodesHevc: false,
  }), ['webrtc', 'llhls', 'hls']);
  assert.equal(shouldUseGridH264Fallback('grid-hevc', 'h264'), false);
});

test('codec desconhecido mantém a contingência segura', () => {
  assert.equal(videoCodecFamily(null), 'unknown');
  assert.equal(shouldUseGridH264Fallback('grid-hevc', null), true);
});

test('preferência aprendida é isolada por modo e família de codec', () => {
  const gridH264 = liveProtocolStorageKey('cam-1', 'grid', 'h264');
  assert.notEqual(gridH264, liveProtocolStorageKey('cam-1', 'selected', 'h264'));
  assert.notEqual(gridH264, liveProtocolStorageKey('cam-1', 'grid', 'h265'));
});

test('modo original testa HEVC por WebRTC mesmo sem declaração do navegador', () => {
  assert.deepEqual(buildLiveProtocolOrder({
    deliveryMode: 'original',
    sourceCodec: 'h265',
    mseDecodesHevc: false,
  }), ['webrtc']);
});
