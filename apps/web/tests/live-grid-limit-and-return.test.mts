import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const livePagePath = new URL('../src/pages/LiveViewPage.tsx', import.meta.url);

test('Preencher tem teto operacional de 6x6, mesmo em instalação grande', async () => {
  const source = await readFile(livePagePath, 'utf8');
  assert.match(source, /FILL_GRID_MAX_CAMERAS\s*=\s*36/);
  assert.match(source, /\{ size: '6x6'/);
  assert.match(source, /Math\.min\(ordered\.length, FILL_GRID_MAX_CAMERAS\)/);
  assert.match(source, /ordered\.slice\(0, Math\.min\(cols \* rows, FILL_GRID_MAX_CAMERAS\)\)/);
});

test('voltar da câmera única restaura o retrato da grade, não um preenchimento antigo', async () => {
  const source = await readFile(livePagePath, 'utf8');
  assert.match(source, /focusReturnLayoutRef/);
  assert.match(source, /cameraIds: current\.cameraIds\.slice\(0, dims\.cols \* dims\.rows\)/);
  assert.match(source, /storeGridSize\(previous\.gridSize\)/);
  assert.match(source, /storeCameraIds\(previous\.cameraIds\)/);
  assert.match(source, /current\.gridSize === '1x1' && currentIds\.length <= 1/);
});
