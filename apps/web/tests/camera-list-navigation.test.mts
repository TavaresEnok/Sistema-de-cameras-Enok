import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const camerasPage = readFileSync(new URL('../src/pages/CamerasPage.tsx', import.meta.url), 'utf8');
const livePage = readFileSync(new URL('../src/pages/LiveViewPage.tsx', import.meta.url), 'utf8');

test('clicar na linha ou no cartão abre a câmera individual, sem roubar o botão editar', () => {
  assert.match(camerasPage, /setLocation\(`\/cameras\/\$\{encodeURIComponent\(cameraId\)\}`\)/);
  assert.ok(
    (camerasPage.match(/onClick=\{\(\) => openCamera\(cam\.id\)\}/g) ?? []).length >= 2,
    'tabela e cartões precisam compartilhar a navegação individual',
  );
  assert.match(camerasPage, /onClick=\{\(\) => setEditCamera\(cam\)\}/);
});

test('painel lateral do ao vivo usa poster autenticado, lote e carregamento tardio', () => {
  assert.match(livePage, /camera-stream\/poster-tokens/);
  assert.match(livePage, /loading="lazy"/);
  assert.match(livePage, /if \(!panelOpen\) return/);
  assert.match(livePage, /retrySidebarPoster\(cam\.id\)/);
});
