'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { avaliarAtrasoDeBackup, explicarAtraso } = require('../src/atraso-de-backup');

// A política é semanal: sete dias sem nova cópia ainda estão dentro do ciclo;
// o oitavo dia indica que uma execução foi perdida.

const DIA = 86400000;
const AGORA = Date.parse('2026-08-25T12:00:00Z');
const haDias = (d) => new Date(AGORA - d * DIA).toISOString();

test('em dia não alarma', () => {
  assert.equal(avaliarAtrasoDeBackup({ ultimoBackupEm: haDias(0), agoraMs: AGORA }).nivel, 'ok');
  assert.equal(avaliarAtrasoDeBackup({ ultimoBackupEm: haDias(7), agoraMs: AGORA }).nivel, 'ok');
});

test('oitavo dia sem cópia vira alerta', () => {
  const a = avaliarAtrasoDeBackup({ ultimoBackupEm: haDias(8), agoraMs: AGORA });
  assert.equal(a.nivel, 'atencao');
  assert.equal(a.dias, 8);
});

test('dois degraus, porque as causas são diferentes', () => {
  assert.equal(avaliarAtrasoDeBackup({ ultimoBackupEm: haDias(8), agoraMs: AGORA }).nivel, 'atencao');
  assert.equal(avaliarAtrasoDeBackup({ ultimoBackupEm: haDias(15), agoraMs: AGORA }).nivel, 'grave');
  assert.equal(avaliarAtrasoDeBackup({ ultimoBackupEm: haDias(30), agoraMs: AGORA }).nivel, 'grave');
});

test('instalação RECÉM-CRIADA não alarma antes da primeira janela', () => {
  // O primeiro envio leva até um dia; alarmar antes ensina a ignorar o alerta.
  const a = avaliarAtrasoDeBackup({ ultimoBackupEm: null, criadaEm: haDias(0.5), agoraMs: AGORA });
  assert.equal(a.nivel, 'ok');
  assert.equal(a.motivo, 'aguardando-primeira');
});

test('instalação ANTIGA que nunca enviou é GRAVE', () => {
  const a = avaliarAtrasoDeBackup({ ultimoBackupEm: null, criadaEm: haDias(30), agoraMs: AGORA });
  assert.equal(a.nivel, 'grave');
  assert.equal(a.motivo, 'nunca-enviou');
  assert.match(explicarAtraso(a, 'vibe'), /NUNCA enviou/);
});

test('sem data de criação, nunca ter enviado já é grave', () => {
  // Não dá para presumir que é nova: presumir para o lado bom esconderia o
  // problema exatamente na instalação de que menos se sabe.
  assert.equal(avaliarAtrasoDeBackup({ ultimoBackupEm: null, agoraMs: AGORA }).nivel, 'grave');
});

test('data ilegível é tratada como ausente, não como recente', () => {
  assert.equal(avaliarAtrasoDeBackup({ ultimoBackupEm: 'ontem', criadaEm: haDias(30), agoraMs: AGORA }).nivel, 'grave');
});

test('a mensagem diz o número de dias', () => {
  const a = avaliarAtrasoDeBackup({ ultimoBackupEm: haDias(8), agoraMs: AGORA });
  assert.match(explicarAtraso(a, 'vibe'), /8 dias/);
  assert.equal(explicarAtraso(avaliarAtrasoDeBackup({ ultimoBackupEm: haDias(0), agoraMs: AGORA }), 'x'), null);
});
