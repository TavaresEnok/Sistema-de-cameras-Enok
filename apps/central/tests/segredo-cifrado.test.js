'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cifrar, decifrar, temSegredo } = require('../src/segredo-cifrado');

const CHAVE = 'chave-de-teste-com-tamanho-suficiente';

test('vai e volta', () => {
  const e = cifrar('senha-da-vpn-do-cliente', CHAVE);
  assert.equal(decifrar(e, CHAVE), 'senha-da-vpn-do-cliente');
});

test('o texto cifrado NÃO contém o segredo', () => {
  const e = cifrar('Gnomos@91582685', CHAVE);
  assert.equal(e.includes('Gnomos'), false);
});

test('cada cifragem é diferente — não dá para comparar duas senhas iguais', () => {
  assert.notEqual(cifrar('mesma', CHAVE), cifrar('mesma', CHAVE));
});

test('chave errada NÃO devolve lixo, falha', () => {
  const e = cifrar('segredo', CHAVE);
  assert.throws(() => decifrar(e, 'outra-chave-igualmente-longa-aqui'));
});

test('segredo ADULTERADO no disco falha ao abrir', () => {
  // É por isso que é GCM e não CBC: lixo silencioso viraria configuração
  // inválida na máquina do cliente, e ninguém saberia por quê.
  const e = cifrar('segredo', CHAVE);
  const partes = e.split('.');
  partes[3] = Buffer.from('adulterado').toString('base64');
  assert.throws(() => decifrar(partes.join('.'), CHAVE));
});

test('SEM chave configurada a cifra RECUSA — não guarda em texto', () => {
  // Falhar fechado: senão uma Central sem a variável gravaria senha de cliente
  // em claro e ninguém veria.
  for (const ruim of ['', '   ', 'curta', undefined, null]) {
    assert.throws(() => cifrar('x', ruim), /DRAC_CENTRAL_SECRET_KEY/);
  }
});

test('texto vazio não vira envelope', () => {
  assert.equal(cifrar('', CHAVE), null);
  assert.equal(cifrar(null, CHAVE), null);
});

test('temSegredo reconhece envelope sem precisar da chave', () => {
  assert.equal(temSegredo(cifrar('x', CHAVE)), true);
  assert.equal(temSegredo('qualquer-coisa'), false);
  assert.equal(temSegredo(null), false);
});

test('formato desconhecido é recusado', () => {
  assert.throws(() => decifrar('v9.a.b.c', CHAVE), /formato desconhecido/i);
});
