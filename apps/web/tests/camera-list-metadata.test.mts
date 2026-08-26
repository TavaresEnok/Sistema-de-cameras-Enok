import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cameraPublicIdLabel,
  cameraSourceProtocol,
  formatStorageBytes,
} from '../src/lib/camera-list-metadata.ts';

test('ID operacional usa a chave numérica única', () => {
  assert.equal(cameraPublicIdLabel(100123, 'uuid-ignorado'), '100123');
});

test('API antiga recebe identificador de transição estável a partir do UUID', () => {
  assert.equal(cameraPublicIdLabel(undefined, '0f93d6a1-1234-4567'), '0F93D6A1');
});

test('protocolo representa como o vídeo chega ao sistema', () => {
  assert.equal(cameraSourceProtocol('rtsp_pull'), 'RTSP');
  assert.equal(cameraSourceProtocol('rtmp_push'), 'RTMP');
});

test('armazenamento é legível sem esconder valores pequenos', () => {
  assert.equal(formatStorageBytes(0), '0 B');
  assert.equal(formatStorageBytes(1536), '1,50 KB');
  assert.equal(formatStorageBytes(4 * 1024 ** 3), '4,00 GB');
});
