import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isPublicIpForGeolocation, parseGeocodeResult, parseIpGeocodeResult } from '../src/cameras/helpers/geocode-address.helper';

test('normaliza uma posição válida do geocodificador', () => {
  assert.deepEqual(parseGeocodeResult([{ lat: '-8.05428', lon: '-34.8813', display_name: 'Recife, Pernambuco, Brasil' }]), {
    latitude: -8.05428,
    longitude: -34.8813,
    displayName: 'Recife, Pernambuco, Brasil',
  });
});

test('aceita IP público e recusa rede privada, CGNAT e marcador RTMP', () => {
  assert.equal(isPublicIpForGeolocation('160.19.47.74'), true);
  assert.equal(isPublicIpForGeolocation('192.168.1.20'), false);
  assert.equal(isPublicIpForGeolocation('100.64.1.2'), false);
  assert.equal(isPublicIpForGeolocation('0.0.0.0'), false);
});

test('normaliza localização aproximada por IP', () => {
  assert.deepEqual(parseIpGeocodeResult({ success: true, latitude: -8.05, longitude: -34.88, city: 'Recife', region: 'Pernambuco', country: 'Brazil' }), {
    latitude: -8.05, longitude: -34.88, displayName: 'Recife, Pernambuco, Brazil',
  });
});

test('descoberta automática só atualiza câmera ainda sem coordenadas', async () => {
  const source = await readFile(new URL('../src/cameras/cameras.service.ts', import.meta.url), 'utf8');
  assert.match(source, /where: \{ id: camera\.id, OR: \[\{ latitude: null \}, \{ longitude: null \}\] \}/);
  assert.match(source, /where: \{ OR: \[\{ latitude: null \}, \{ longitude: null \}\] \}/);
  assert.doesNotMatch(source, /where: \{ enabled: true, OR: \[\{ latitude: null \}, \{ longitude: null \}\] \}/);
});

test('o próprio sistema agenda a descoberta sem depender da página do mapa', async () => {
  const source = await readFile(new URL('../src/cameras/cameras.service.ts', import.meta.url), 'utf8');
  assert.match(source, /implements OnApplicationBootstrap/);
  assert.match(source, /this\.autoDiscoverLocations\(\)/);
  assert.match(source, /execute\(\);/);
  assert.match(source, /setTimeout\(execute, 60_000\)/);
  assert.match(source, /setInterval\(execute, 6 \* 60 \* 60 \* 1_000\)/);
});

test('rejeita resposta vazia ou coordenadas fora do planeta', () => {
  assert.equal(parseGeocodeResult([]), null);
  assert.equal(parseGeocodeResult([{ lat: '200', lon: '0' }]), null);
});
