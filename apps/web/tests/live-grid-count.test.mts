import test from 'node:test';
import assert from 'node:assert/strict';
import { countVisibleGridCameras } from '../src/lib/live-grid-count.ts';

test('conta apenas câmeras presentes, sem incluir slots vazios ou a frota inteira', () => {
  const grid = [{ id: 'a', isOnline: true }, null, { id: 'b', isOnline: false }, { id: 'c', isOnline: true }];
  assert.deepEqual(countVisibleGridCameras(grid, null), { online: 2, total: 3 });
});

test('câmera ampliada é a única contada', () => {
  const grid = [{ id: 'a', isOnline: true }, { id: 'b', isOnline: false }];
  assert.deepEqual(countVisibleGridCameras(grid, 'b'), { online: 0, total: 1 });
  assert.deepEqual(countVisibleGridCameras(grid, 'a'), { online: 1, total: 1 });
});
