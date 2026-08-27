import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('mapa geográfico inclui todas as câmeras e não exige unidade para aparecer', async () => {
  const page = await read('src/pages/MapPage.tsx');
  assert.match(page, /GeographicCameraMap cameras=\{cameras\.filter/);
  assert.match(page, /Definir endereço/);
  assert.doesNotMatch(page, /Associe uma unidade às câmeras/);
});

test('edição da câmera permite endereço, localização automática e coordenadas manuais', async () => {
  const sheet = await read('src/components/CameraEditSheet.tsx');
  assert.match(sheet, /Localização no mapa/);
  assert.match(sheet, /location\/geocode/);
  assert.match(sheet, /latitude/);
  assert.match(sheet, /longitude/);
});

test('coordenada ausente não vira 0,0 no Atlântico', async () => {
  const store = await read('src/store/vmsDataStore.ts');
  assert.match(store, /camera\.latitude === null \|\| camera\.latitude === undefined \|\| camera\.latitude === ''/);
  assert.match(store, /camera\.longitude === null \|\| camera\.longitude === undefined \|\| camera\.longitude === ''/);
});

test('mapa tenta localizar câmeras sem posição e preserva edição manual', async () => {
  const page = await read('src/pages/MapPage.tsx');
  assert.match(page, /cameras\/location\/auto-discover/);
  assert.match(page, /Tentar localizar/);
  // O teste de persistência vive na API; aqui garantimos que o cliente não
  // inventa coordenadas nem chama geolocalização pública diretamente.
  assert.doesNotMatch(page, /ipwho\.is/);
});

test('mapa usa motor geográfico estável e impede salto entre cópias do mundo', async () => {
  const map = await read('src/components/GeographicCameraMap.tsx');
  assert.match(map, /MapContainer/);
  assert.match(map, /maxBounds=\{WORLD_BOUNDS\}/);
  assert.match(map, /maxBoundsViscosity=\{1\}/);
  assert.match(map, /worldCopyJump=\{false\}/);
  assert.match(map, /noWrap/);
  assert.doesNotMatch(map, /onPointerMove/);
  assert.doesNotMatch(map, /nativeEvent\.offset[XY]/);
});

test('mapa usa pin de câmera com estado e contador em vez de círculo genérico', async () => {
  const map = await read('src/components/GeographicCameraMap.tsx');
  const css = await read('src/index.css');
  assert.match(map, /divIcon/);
  assert.match(map, /<Marker/);
  assert.match(map, /camera-map-pin__count/);
  assert.match(map, /posição estimada/);
  assert.doesNotMatch(map, /CircleMarker/);
  assert.match(css, /\.camera-map-pin--online/);
  assert.match(css, /\.camera-map-pin--offline/);
  assert.match(css, /\.camera-map-pin--estimated/);
});
