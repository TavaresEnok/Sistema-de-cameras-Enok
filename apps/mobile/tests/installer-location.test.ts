import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInstallerLocationPayload } from '../src/services/installer-location-core';

test('localização do telefone vira metadado da câmera', () => {
  assert.deepEqual(buildInstallerLocationPayload(-8.0522, -34.9286, 9.7), {
    latitude: -8.0522,
    longitude: -34.9286,
    locationAddress: 'GPS do dispositivo usado no cadastro · precisão aproximada de 10 m',
  });
});

test('coordenadas inválidas do telefone são descartadas', () => {
  assert.equal(buildInstallerLocationPayload(undefined, -34), null);
  assert.equal(buildInstallerLocationPayload(-91, -34), null);
  assert.equal(buildInstallerLocationPayload(-8, 181), null);
});
