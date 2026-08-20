import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLiveProtocolOrder,
  hasWebrtcInboundProgress,
  liveProtocolStorageKey,
  shouldRetryWebrtcStartup,
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

test('vivacidade do WebRTC usa frames RTP e recorre a bytes quando necessário', () => {
  assert.equal(hasWebrtcInboundProgress(null, { bytesReceived: 100, framesDecoded: 2 }), true);
  assert.equal(hasWebrtcInboundProgress(
    { bytesReceived: 100, framesDecoded: 2 },
    { bytesReceived: 200, framesDecoded: 3 },
  ), true);
  assert.equal(hasWebrtcInboundProgress(
    { bytesReceived: 100, framesDecoded: 2 },
    { bytesReceived: 200, framesDecoded: 2 },
  ), false, 'bytes não escondem um decoder que parou quando a métrica de frames existe');
  assert.equal(hasWebrtcInboundProgress(
    { bytesReceived: 100, framesDecoded: null },
    { bytesReceived: 200, framesDecoded: null },
  ), true);
});

test('primeiro quadro ausente repete WebRTC uma vez antes do HLS', () => {
  assert.equal(shouldRetryWebrtcStartup(
    'WebRTC conectou, mas não entregou imagem dentro do tempo limite.',
    0,
  ), true);
  assert.equal(shouldRetryWebrtcStartup('Falha ao conectar WebRTC (400).', 0), false);
  assert.equal(shouldRetryWebrtcStartup('WebRTC conectou, mas não entregou imagem.', 1), false);
});
