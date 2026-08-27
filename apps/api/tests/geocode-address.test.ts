import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeocodeResult } from '../src/cameras/helpers/geocode-address.helper';

test('normaliza uma posição válida do geocodificador', () => {
  assert.deepEqual(parseGeocodeResult([{ lat: '-8.05428', lon: '-34.8813', display_name: 'Recife, Pernambuco, Brasil' }]), {
    latitude: -8.05428,
    longitude: -34.8813,
    displayName: 'Recife, Pernambuco, Brasil',
  });
});

test('rejeita resposta vazia ou coordenadas fora do planeta', () => {
  assert.equal(parseGeocodeResult([]), null);
  assert.equal(parseGeocodeResult([{ lat: '200', lon: '0' }]), null);
});
