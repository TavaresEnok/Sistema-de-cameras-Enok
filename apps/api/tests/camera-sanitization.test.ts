import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeCamera } from '../src/cameras/cameras.service';

test('resposta de câmera nunca expõe senha nem material da chave RTMP', () => {
  const safe = sanitizeCamera({
    id: 'cam-1',
    name: 'Entrada',
    passwordEncrypted: 'cipher-password',
    rtmpIngestKeyHash: 'hash-key',
    rtmpIngestKeyEncrypted: 'cipher-key',
  });
  assert.deepEqual(safe, { id: 'cam-1', name: 'Entrada' });
});

