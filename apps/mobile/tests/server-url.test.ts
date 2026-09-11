import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApiUrl } from '../src/utils/server-url';

test('migra domínio principal antigo para S2Cam preservando /api', () => {
  assert.equal(normalizeApiUrl('https://ajustcam.ajustconsulting.com.br/api'), 'https://principal.s2cam.com.br/api');
});

test('migra subdomínio temporário do tenant para o domínio oficial', () => {
  assert.equal(normalizeApiUrl('http://vibe.cam.ajustconsulting.com.br/api?x=1'), 'https://vibe.s2cam.com.br/api');
});

test('não reescreve instalações locais ou domínios de terceiros', () => {
  assert.equal(normalizeApiUrl('http://192.168.1.10:5173/api'), 'http://192.168.1.10:5173/api');
  assert.equal(normalizeApiUrl('https://cliente.exemplo.com/api'), 'https://cliente.exemplo.com/api');
});
