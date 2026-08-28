import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capturarLocalizacaoDoInstalador,
  payloadDaLocalizacaoDoInstalador,
} from '../src/lib/localizacao-do-instalador.ts';

const position = (latitude: number, longitude: number, accuracy = 8) => ({
  coords: { latitude, longitude, accuracy },
} as GeolocationPosition);

test('GPS válido vira coordenada vinculável à câmera e registra a precisão', () => {
  assert.deepEqual(payloadDaLocalizacaoDoInstalador(position(-8.0522, -34.9286, 7.6)), {
    latitude: -8.0522,
    longitude: -34.9286,
    locationAddress: 'GPS do dispositivo usado no cadastro · precisão aproximada de 8 m',
  });
});

test('coordenada inválida nunca é enviada ao cadastro', () => {
  assert.equal(payloadDaLocalizacaoDoInstalador(position(100, -34)), null);
  assert.equal(payloadDaLocalizacaoDoInstalador(position(-8, 200)), null);
});

test('permissão negada preserva o cadastro e deixa o GeoIP assumir', async () => {
  const geolocation = {
    getCurrentPosition(_ok: PositionCallback, error: PositionErrorCallback) {
      error({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
    },
  };
  assert.equal(await capturarLocalizacaoDoInstalador(geolocation), null);
});

test('captura autorizada devolve o payload completo', async () => {
  const geolocation = {
    getCurrentPosition(ok: PositionCallback) { ok(position(-8.05, -34.88, 12)); },
  };
  assert.deepEqual(await capturarLocalizacaoDoInstalador(geolocation), {
    latitude: -8.05,
    longitude: -34.88,
    locationAddress: 'GPS do dispositivo usado no cadastro · precisão aproximada de 12 m',
  });
});
