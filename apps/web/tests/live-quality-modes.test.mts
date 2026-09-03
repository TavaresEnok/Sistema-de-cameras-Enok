import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const playerPath = new URL('../src/components/LiveStreamPlayer.tsx', import.meta.url);
const apiProfilePath = new URL('../../api/src/camera-stream/helpers/live-delivery-profile.helper.ts', import.meta.url);
const pushDialogPath = new URL('../src/components/AddPushCameraDialog.tsx', import.meta.url);

test('câmera individual oferece somente Instantâneo e Máxima resolução', async () => {
  const source = await readFile(playerPath, 'utf8');
  assert.match(source, /type LiveQualityMode = 'instant' \| 'max'/);
  assert.match(source, /\['instant', 'Instantâneo'/);
  assert.match(source, /'max',[\s\S]*'Máxima resolução'/);
  assert.doesNotMatch(source, /Equilibrado|qualityMode === 'balanced'|\['balanced'/i);
});

test('backend não mantém o perfil transcodificado da câmera individual', async () => {
  const source = await readFile(apiProfilePath, 'utf8');
  assert.match(source, /LiveViewMode = 'grid' \| 'grid-hevc' \| 'original'/);
  assert.doesNotMatch(source, /'selected'/);
});

test('cadastro RTMP nasce com gravação manual e desligada', async () => {
  const source = await readFile(pushDialogPath, 'utf8');
  assert.match(source, /recordingEnabled:\s*false/);
  assert.match(source, /recordingMode:\s*'manual'/);
});
