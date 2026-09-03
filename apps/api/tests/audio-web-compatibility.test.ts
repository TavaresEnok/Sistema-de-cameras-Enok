import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const proxy = readFileSync(join(raiz, 'src/camera-stream/mediamtx-proxy.service.ts'), 'utf8');

test('áudio habilitado cria publisher e converte AAC para Opus no WebRTC', () => {
  assert.match(proxy, /isHevc \|\| sanitizeGridSource \|\| Boolean\(camera\.audioEnabled\)/);
  assert.match(proxy, /-map 0:a:0\? -c:a libopus -b:a 64k -ac 1 -ar 48000/);
});

test('áudio desabilitado continua removendo a trilha explicitamente', () => {
  assert.match(proxy, /camera\.audioEnabled[\s\S]*?\? '-map 0:a:0\? -c:a libopus[\s\S]*?: '-an'/);
});
