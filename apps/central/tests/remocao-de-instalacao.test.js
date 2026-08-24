'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decidirRemocao } = require('../src/remocao-de-instalacao');

const viva = { id: 'dguardian', lastHeartbeatAt: '2026-08-20T19:57:00Z' };
const pendente = { id: 'cliente-novo', lastHeartbeatAt: null };

test('instalação inexistente devolve 404', () => {
  const d = decidirRemocao({ existente: null, confirmacao: 'x' });
  assert.equal(d.permitido, false);
  assert.equal(d.http, 404);
});

test('provisionamento pendente é cancelado sem digitar nada', () => {
  // Nunca teve licença ativa: cancelar não tira nada de ninguém.
  const d = decidirRemocao({ existente: pendente, confirmacao: '' });
  assert.equal(d.permitido, true);
  assert.equal(d.motivo, 'cancelar-pendente');
});

test('O CASO REAL: instalação ATIVA exige digitar o código', () => {
  // Remover tira a licença do cliente: em 15 dias o sistema dele para.
  // Um clique errado na lista de frota nao pode fazer isso.
  assert.equal(decidirRemocao({ existente: viva, confirmacao: '' }).permitido, false);
  assert.equal(decidirRemocao({ existente: viva, confirmacao: '' }).http, 428);
  assert.equal(decidirRemocao({ existente: viva, confirmacao: 'dguardia' }).permitido, false);
  assert.equal(decidirRemocao({ existente: viva, confirmacao: 'DGUARDIAN' }).permitido, false, 'confirmação é sensível a maiúsculas');
  assert.equal(decidirRemocao({ existente: viva, confirmacao: 'dguardian' }).permitido, true);
});

test('espaços em volta da confirmação são tolerados', () => {
  assert.equal(decidirRemocao({ existente: viva, confirmacao: '  dguardian  ' }).permitido, true);
});
