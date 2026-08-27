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
