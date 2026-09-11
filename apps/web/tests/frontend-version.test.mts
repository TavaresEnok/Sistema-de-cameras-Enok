import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainPath = new URL('../src/main.tsx', import.meta.url);
const guardPath = new URL('../src/lib/frontend-version.ts', import.meta.url);
const vitePath = new URL('../vite.config.ts', import.meta.url);
const nginxPath = new URL('../nginx.conf', import.meta.url);

test('build publica uma identidade e o navegador instala a proteção de versão', async () => {
  const [main, guard, vite] = await Promise.all([
    readFile(mainPath, 'utf8'),
    readFile(guardPath, 'utf8'),
    readFile(vitePath, 'utf8'),
  ]);

  assert.match(vite, /fileName: 'frontend-version\.json'/);
  assert.match(vite, /__S2CAM_FRONTEND_BUILD_ID__/);
  assert.match(main, /installFrontendVersionGuard\(\)/);
  assert.match(guard, /publishedBuildId === __S2CAM_FRONTEND_BUILD_ID__/);
  assert.match(guard, /window\.location\.reload\(\)/);
  assert.match(guard, /visibilitychange/);
});

test('manifesto de versão nunca é armazenado pelo nginx', async () => {
  const nginx = await readFile(nginxPath, 'utf8');
  assert.match(nginx, /location = \/frontend-version\.json[\s\S]*Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate"/);
});
