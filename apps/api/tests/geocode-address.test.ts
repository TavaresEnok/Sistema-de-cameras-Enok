import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { parseGeocodeResult } from '../src/cameras/helpers/geocode-address.helper';

test('normaliza uma posição válida do geocodificador', () => {
  assert.deepEqual(parseGeocodeResult([{ lat: '-8.05428', lon: '-34.8813', display_name: 'Recife, Pernambuco, Brasil' }]), {
    latitude: -8.05428,
    longitude: -34.8813,
    displayName: 'Recife, Pernambuco, Brasil',
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

// ── A DECISÃO FICA FIXADA AQUI ──────────────────────────────────────────────

test('ESTIMATIVA POR IP NÃO PODE VOLTAR', () => {
  // Removida em 28/08/2026 depois de pôr 25 câmeras na mesma coordenada, num
  // bairro onde nenhuma delas está. IP não diz onde a câmera está: diz por onde
  // a internet dela sai, que é o equipamento do provedor.
  //
  // Se alguém precisar disso de novo, que seja uma decisão consciente — e que
  // apague este teste explicando por quê.
  const helper = readFileSync(
    new URL('../src/cameras/helpers/geocode-address.helper.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(helper, /parseIpGeocodeResult\s*\(/,
    'a leitura de geolocalização por IP voltou ao helper');
  assert.doesNotMatch(helper, /export function isPublicIpForGeolocation/,
    'a checagem de IP público voltou ao helper');

  const servico = readFileSync(
    new URL('../src/cameras/cameras.service.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(servico, /ipwho\.is/,
    'o serviço voltou a consultar um localizador por IP');
  assert.doesNotMatch(servico, /Estimativa por IP/,
    'o serviço voltou a gravar posição estimada por IP');
});
