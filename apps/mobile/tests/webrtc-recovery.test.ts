import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webRtcRetryDelay, webRtcSessionIdentity } from '../src/utils/webrtc-recovery';

test('falhas consecutivas têm duas recuperações limitadas, sem loop de protocolo', () => {
  assert.deepEqual([1, 2, 3, 4, 100].map(webRtcRetryDelay), [1000, 3000, null, null, null]);
});

test('renovar token preserva sessão; trocar câmera ou perfil exige nova sessão', () => {
  const original = webRtcSessionIdentity('https://example.test/cam_orig/whep?token=old&profile=main');
  assert.equal(original, webRtcSessionIdentity('https://example.test/cam_orig/whep?token=new&profile=main'));
  assert.notEqual(original, webRtcSessionIdentity('https://example.test/cam_grid/whep?token=new&profile=sub'));
  assert.notEqual(original, webRtcSessionIdentity('https://example.test/cam_other/whep?token=new&profile=main'));
});
