'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { venceu, selecionarVencidos } = require('../src/expiracao-de-arquivo');

// ─────────────────────────────────────────────────────────────────────────────
// A política de privacidade publicada promete apagar o arquivo de reativação em
// 24 meses. Em 17/08/2026 a promessa NÃO era cumprida: o vencimento era
// calculado e gravado, e nada varria o diretório — o arquivo cifrado do cliente
// cancelado ficaria no disco para sempre.
// ─────────────────────────────────────────────────────────────────────────────

const AGORA = new Date('2026-08-17T12:00:00Z');

test('vencido no passado É para apagar', () => {
  assert.equal(venceu('2026-08-16T12:00:00Z', AGORA), true);
});

test('ainda dentro do prazo NÃO é apagado', () => {
  assert.equal(venceu('2028-08-17T12:00:00Z', AGORA), false);
});

test('data AUSENTE nunca apaga — na dúvida o dado do cliente fica', () => {
  // Errar para o lado de guardar custa disco; errar para o outro destrói o que
  // o cliente pagou para preservar, sem volta.
  for (const vazio of [null, undefined, '']) {
    assert.equal(venceu(vazio, AGORA), false);
  }
});

test('data ILEGÍVEL nunca apaga', () => {
  assert.equal(venceu('nao-e-data', AGORA), false);
  assert.equal(venceu('2026-13-45', AGORA), false);
});

test('vencimento exatamente agora conta como vencido', () => {
  assert.equal(venceu('2026-08-17T12:00:00Z', AGORA), true);
});

test('só arquivo DISPONÍVEL entra na varredura', () => {
  // Repetir a exclusão encheria a auditoria de eventos falsos.
  const lista = selecionarVencidos([
    { id: 'a', reactivationArchive: { state: 'AVAILABLE', expiresAt: '2026-01-01T00:00:00Z' } },
    { id: 'b', reactivationArchive: { state: 'DELETED', expiresAt: '2026-01-01T00:00:00Z' } },
    { id: 'c', reactivationArchive: { state: 'REQUESTED', expiresAt: '2026-01-01T00:00:00Z' } },
  ], AGORA);
  assert.deepEqual(lista.map((x) => x.installationId), ['a']);
});

test('instalação SEM arquivo não entra', () => {
  const lista = selecionarVencidos([
    { id: 'a' },
    { id: 'b', reactivationArchive: null },
  ], AGORA);
  assert.deepEqual(lista, []);
});

test('arquivo dentro do prazo não entra na varredura', () => {
  const lista = selecionarVencidos([
    { id: 'a', reactivationArchive: { state: 'AVAILABLE', expiresAt: '2029-01-01T00:00:00Z' } },
  ], AGORA);
  assert.deepEqual(lista, []);
});

test('entrada inválida não quebra a varredura', () => {
  // Rotina que roda sozinha não pode derrubar a Central por um registro torto.
  assert.deepEqual(selecionarVencidos(null), []);
  assert.deepEqual(selecionarVencidos([null, undefined]), []);
});
