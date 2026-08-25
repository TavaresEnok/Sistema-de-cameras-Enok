'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validarPerfilDeVpn,
  perfilParaHeartbeat,
  perfilParaPainel,
} = require('../src/perfil-de-vpn');

const base = {
  tipo: 'l2tp-ipsec',
  nome: 'loja',
  servidor: 'vpn.cliente.com.br',
  usuario: 'drac',
  faixas: '192.168.100.0/24',
  cameras: '192.168.100.11, 192.168.100.12',
};

test('perfil completo é aceito', () => {
  const r = validarPerfilDeVpn(base);
  assert.equal(r.ok, true);
  assert.deepEqual(r.perfil.faixas, ['192.168.100.0/24']);
  assert.deepEqual(r.perfil.cameras, ['192.168.100.11', '192.168.100.12']);
});

test('ROTA PADRÃO é recusada — sequestraria a internet do servidor', () => {
  // 0.0.0.0/0 jogaria TODO o tráfego para dentro da rede do cliente: o painel
  // para de responder no endereço público e todo mundo perde acesso.
  for (const veneno of ['0.0.0.0/0', '0.0.0.0/1', '128.0.0.0/1']) {
    const r = validarPerfilDeVpn({ ...base, faixas: veneno });
    assert.equal(r.ok, false, `${veneno} deveria ser recusada`);
    assert.equal(r.motivo, 'faixa-sequestra-a-internet');
  }
});

test('rota padrão escondida no meio da lista também é pega', () => {
  const r = validarPerfilDeVpn({ ...base, faixas: '192.168.1.0/24, 0.0.0.0/0' });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'faixa-sequestra-a-internet');
});

test('PROVA DE VIDA é obrigatória', () => {
  // Sem endereço de câmera o vigia só saberia perguntar ao próprio túnel — que
  // responde sempre. Foi assim que o D-GUARDIAN ficou 8 horas sem gravar com
  // tudo "verde".
  const r = validarPerfilDeVpn({ ...base, cameras: '' });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'prova-de-vida-ausente');
});

test('tipo desconhecido é recusado com a lista do que existe', () => {
  const r = validarPerfilDeVpn({ ...base, tipo: 'pptp' });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'tipo-desconhecido');
  assert.match(r.detalhe, /wireguard/);
});

test('os três tipos suportados passam', () => {
  for (const tipo of ['l2tp-ipsec', 'wireguard', 'openvpn']) {
    assert.equal(validarPerfilDeVpn({ ...base, tipo }).ok, true, tipo);
  }
});

test('faixa que conflita com outro cliente no mesmo servidor é recusada', () => {
  const r = validarPerfilDeVpn(
    { ...base, nome: 'loja-b', faixas: '192.168.1.0/24' },
    [{ nome: 'loja-a', faixas: '192.168.1.0/24' }],
  );
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'faixa-em-conflito');
});

test('servidor e tipo ausentes são recusados', () => {
  assert.equal(validarPerfilDeVpn({ ...base, servidor: '' }).motivo, 'servidor-ausente');
  assert.equal(validarPerfilDeVpn({ ...base, tipo: '' }).motivo, 'tipo-ausente');
});

test('O PAINEL nunca recebe segredo, nem cifrado', () => {
  const guardado = {
    tipo: 'l2tp-ipsec', nome: 'loja', servidor: 'x', usuario: 'drac',
    faixas: ['192.168.100.0/24'], cameras: ['192.168.100.11'],
    senhaCifrada: 'AAAA', segredoCifrado: 'BBBB', revisao: 3,
  };
  const p = perfilParaPainel(guardado);
  assert.equal(p.temSenha, true);
  assert.equal(p.temSegredo, true);
  assert.equal(JSON.stringify(p).includes('AAAA'), false);
  assert.equal(JSON.stringify(p).includes('BBBB'), false);
});

test('a INSTALAÇÃO recebe os segredos cifrados — é ela quem precisa deles', () => {
  const guardado = {
    tipo: 'wireguard', nome: 'loja', servidor: 'x',
    faixas: ['10.8.0.0/24'], cameras: ['10.8.0.11'],
    senhaCifrada: 'AAAA', segredoCifrado: 'BBBB', revisao: 2,
  };
  const h = perfilParaHeartbeat(guardado);
  assert.equal(h.senhaCifrada, 'AAAA');
  assert.equal(h.revisao, 2);
});

test('instalação SEM VPN recebe null, não perfil vazio', () => {
  // Perfil vazio faria a instalação concluir que precisa desmontar um túnel.
  assert.equal(perfilParaHeartbeat(null), null);
  assert.equal(perfilParaHeartbeat({}), null);
  assert.equal(perfilParaPainel(undefined), null);
});
