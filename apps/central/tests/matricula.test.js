'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decidirMatricula } = require('../src/matricula');

// Comparação simples só para o teste; em produção é a de tempo constante.
const comparar = (a, b) => a === b;
const base = { tokenConfigurado: 'segredo', tokenApresentado: 'segredo', chaveApresentada: '', comparar };

test('O CASO REAL: instalação nova se matricula e é criada', () => {
  const d = decidirMatricula({ ...base, existente: null });
  assert.equal(d.permitido, true);
  assert.equal(d.motivo, 'criar');
});

test('SEM token configurado, a matrícula fica DESLIGADA — não aberta', () => {
  // Token vazio casaria com qualquer coisa e reabriria o buraco que permitia
  // a qualquer um na internet registrar instalações.
  for (const vazio of ['', '   ', null, undefined]) {
    const d = decidirMatricula({ ...base, tokenConfigurado: vazio, existente: null });
    assert.equal(d.permitido, false, `token configurado "${vazio}" deveria RECUSAR`);
    assert.equal(d.motivo, 'matricula-desligada');
  }
});

test('token errado é recusado', () => {
  const d = decidirMatricula({ ...base, tokenApresentado: 'chute', existente: null });
  assert.equal(d.permitido, false);
  assert.equal(d.motivo, 'token-invalido');
  assert.equal(d.http, 403);
});

test('token ausente é recusado mesmo com a Central configurada', () => {
  for (const vazio of ['', null, undefined]) {
    assert.equal(decidirMatricula({ ...base, tokenApresentado: vazio, existente: null }).permitido, false);
  }
});

test('reinstalar instalação que NUNCA deu sinal de vida é permitido', () => {
  // Caso comum: a primeira instalação deu errado e se refaz a máquina.
  const d = decidirMatricula({ ...base, existente: { id: 'x', licenseKey: 'antiga', lastHeartbeatAt: null } });
  assert.equal(d.permitido, true);
  assert.equal(d.motivo, 'reinstalar');
});

test('instalação VIVA não pode ser tomada por quem chega com outra chave', () => {
  // Senão o token de matrícula viraria um jeito de sequestrar cliente alheio.
  const viva = { id: 'x', licenseKey: 'chave-do-dono', lastHeartbeatAt: '2026-08-24T10:00:00Z' };
  const d = decidirMatricula({ ...base, existente: viva, chaveApresentada: 'outra' });
  assert.equal(d.permitido, false);
  assert.equal(d.motivo, 'instalacao-ativa');
  assert.equal(d.http, 409);
});

test('instalação viva aceita quem PROVA a chave atual (matrícula repetida)', () => {
  // Rodar o instalador de novo na mesma máquina não pode quebrar nada.
  const viva = { id: 'x', licenseKey: 'chave-do-dono', lastHeartbeatAt: '2026-08-24T10:00:00Z' };
  const d = decidirMatricula({ ...base, existente: viva, chaveApresentada: 'chave-do-dono' });
  assert.equal(d.permitido, true);
  assert.equal(d.motivo, 'ja-matriculada');
});

test('instalação viva sem chave apresentada é recusada', () => {
  const viva = { id: 'x', licenseKey: 'chave-do-dono', lastHeartbeatAt: '2026-08-24T10:00:00Z' };
  assert.equal(decidirMatricula({ ...base, existente: viva, chaveApresentada: '' }).permitido, false);
});
