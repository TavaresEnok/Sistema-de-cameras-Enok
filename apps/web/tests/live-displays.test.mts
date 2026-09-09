import test from 'node:test';
import assert from 'node:assert/strict';
import { findCameraDisplay, type LiveDisplayPresence } from '../src/lib/live-display-coordination.ts';

test('encontra câmera somente em outra tela ainda ativa', () => {
  const now = 100_000;
  const displays: Record<string, LiveDisplayPresence> = {
    main: { displayId: 'main', instanceId: 'a', openedAt: 1, cameraIds: ['cam-1'], updatedAt: now },
    'aux-1': { displayId: 'aux-1', instanceId: 'b', openedAt: 2, cameraIds: ['cam-2'], updatedAt: now - 1_000 },
  };
  assert.equal(findCameraDisplay(displays, 'cam-2', 'main', now)?.displayId, 'aux-1');
  assert.equal(findCameraDisplay(displays, 'cam-1', 'main', now), null);
});

test('presença vencida não bloqueia a câmera após a janela fechar', () => {
  const now = 100_000;
  const displays: Record<string, LiveDisplayPresence> = {
    'aux-1': { displayId: 'aux-1', instanceId: 'b', openedAt: 2, cameraIds: ['cam-2'], updatedAt: now - 9_000 },
  };
  assert.equal(findCameraDisplay(displays, 'cam-2', 'main', now), null);
});
