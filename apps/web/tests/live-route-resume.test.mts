import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const playerPath = fileURLToPath(new URL('../src/components/LiveStreamPlayer.tsx', import.meta.url));
const tilePath = fileURLToPath(new URL('../src/components/CameraTile.tsx', import.meta.url));
const livePath = fileURLToPath(new URL('../src/pages/LiveViewPage.tsx', import.meta.url));

test('retorno à rota ao vivo recupera sessão retida que não voltou a renderizar', async () => {
  const source = await readFile(playerPath, 'utf8');
  assert.match(source, /routeActive\?: boolean/);
  assert.match(source, /renderedAfter > renderedBefore/);
  assert.match(source, /requestFreshLiveBoot\('Retomando câmera em tempo real…', false, true\)/);
  assert.match(source, /if \(!routeActive \|\| document\.hidden/);
});

test('atividade da rota chega da página até cada player da grade', async () => {
  const [tile, live] = await Promise.all([
    readFile(tilePath, 'utf8'),
    readFile(livePath, 'utf8'),
  ]);
  assert.match(tile, /routeActive=\{routeActive\}/);
  assert.match(live, /routeActive=\{pageActive\}/);
});
