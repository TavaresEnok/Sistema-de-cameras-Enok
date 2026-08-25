'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lerCidr, seSobrepoe, validarFaixasDoTunel } = require('../src/faixas-de-rede');

// "e se fizerem 50 cameras cada uma com uma vpn diferente?" (dono, 24/08/2026)
//
// A VPN é por REDE, não por câmera. O perigo real é um servidor com túneis para
// EMPRESAS diferentes: quase todo roteador do Brasil sai de fábrica em
// 192.168.1.0/24, e dois túneis nessa faixa fazem o servidor entregar a imagem
// do cliente ERRADO — sem erro, sem aviso.

test('O CASO REAL: duas lojas na faixa de fábrica colidem', () => {
  const r = validarFaixasDoTunel({
    nome: 'loja-b',
    faixas: '192.168.1.0/24',
    outros: [{ nome: 'loja-a', faixas: '192.168.1.0/24' }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'faixa-em-conflito');
  assert.match(r.detalhe, /loja-a/);
});

test('faixas diferentes convivem', () => {
  const r = validarFaixasDoTunel({
    nome: 'loja-b',
    faixas: '192.168.20.0/24',
    outros: [{ nome: 'loja-a', faixas: '192.168.1.0/24' }],
  });
  assert.equal(r.ok, true);
});

test('faixa que CONTÉM outra também é conflito', () => {
  // 192.168.0.0/16 engole 192.168.1.0/24 — o roteamento fica ambíguo do mesmo
  // jeito, e é o erro mais fácil de cometer ("vou liberar a rede toda").
  const r = validarFaixasDoTunel({
    nome: 'b',
    faixas: '192.168.0.0/16',
    outros: [{ nome: 'a', faixas: '192.168.1.0/24' }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'faixa-em-conflito');
});

test('o host escrito no lugar da rede não engana a comparação', () => {
  // 192.168.1.77/24 e 192.168.1.0/24 são a MESMA faixa. Aceitar como
  // diferentes deixaria a colisão passar.
  assert.equal(seSobrepoe('192.168.1.77/24', '192.168.1.0/24'), true);
  assert.deepEqual(lerCidr('192.168.1.77/24').base, lerCidr('192.168.1.0/24').base);
});

test('reconfigurar o MESMO túnel não conflita consigo mesmo', () => {
  const r = validarFaixasDoTunel({
    nome: 'loja-a',
    faixas: '192.168.1.0/24',
    outros: [{ nome: 'loja-a', faixas: '192.168.1.0/24' }],
  });
  assert.equal(r.ok, true);
});

test('faixa mal escrita é RECUSADA, não ignorada', () => {
  // Ignorar em silêncio deixaria o túnel de pé sem rota para as câmeras — o
  // defeito que o D-GUARDIAN teve: tudo "verde" e 8 horas sem gravar.
  for (const ruim of ['192.168.1.0', '192.168.1.0/33', '300.1.1.0/24', 'rede-do-cliente', '']) {
    const r = validarFaixasDoTunel({ nome: 'x', faixas: ruim, outros: [] });
    assert.equal(r.ok, false, `"${ruim}" deveria ser recusada`);
  }
});

test('várias faixas no mesmo túnel são aceitas', () => {
  // Cliente com câmeras em duas redes internas é comum.
  const r = validarFaixasDoTunel({ nome: 'x', faixas: '192.168.1.0/24, 10.20.0.0/16', outros: [] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.faixas, ['192.168.1.0/24', '10.20.0.0/16']);
});

test('conflito é detectado em QUALQUER uma das faixas da lista', () => {
  const r = validarFaixasDoTunel({
    nome: 'b',
    faixas: '10.50.0.0/16, 192.168.1.0/24',
    outros: [{ nome: 'a', faixas: '192.168.1.0/24' }],
  });
  assert.equal(r.ok, false);
});
