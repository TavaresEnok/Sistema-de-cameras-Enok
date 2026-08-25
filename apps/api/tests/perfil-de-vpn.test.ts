import test from 'node:test';
import assert from 'node:assert/strict';
import { decidirSobreVpn, type PerfilDeVpn } from '../src/cloud-connector/helpers/perfil-de-vpn.helper';

// O túnel serve para ESTA instalação alcançar as CÂMERAS do cliente quando o
// servidor não está dentro da rede dele. Nada a ver com o contato com a Central.

const bom: PerfilDeVpn = {
  tipo: 'l2tp-ipsec',
  nome: 'loja',
  servidor: 'vpn.cliente.com.br',
  faixas: ['192.168.100.0/24'],
  cameras: ['192.168.100.11'],
  revisao: 1,
};

test('perfil novo é aplicado', () => {
  assert.deepEqual(decidirSobreVpn(bom, null), { acao: 'aplicar', motivo: 'primeira-vez' });
});

test('o MESMO perfil não é reaplicado a cada heartbeat', () => {
  // O heartbeat roda a cada minuto. Reaplicar derrubaria o túnel por segundos,
  // toda vez — e as câmeras cairiam junto.
  assert.deepEqual(decidirSobreVpn(bom, 1), { acao: 'manter', motivo: 'ja-aplicado' });
});

test('revisão nova é aplicada', () => {
  assert.equal(decidirSobreVpn({ ...bom, revisao: 2 }, 1).acao, 'aplicar');
});

test('ROTA PADRÃO é recusada aqui TAMBÉM, mesmo a Central já recusando', () => {
  // Trava que existe só de um lado é trava que um dia não existe. Um perfil
  // com 0.0.0.0/0 jogaria todo o tráfego do servidor para dentro da rede do
  // cliente: o painel some do endereço público e todo mundo perde acesso.
  for (const veneno of ['0.0.0.0/0', '0.0.0.0/1', '128.0.0.0/1', '::/0']) {
    const d = decidirSobreVpn({ ...bom, faixas: [veneno] }, null);
    assert.equal(d.acao, 'recusar', `${veneno} deveria ser recusada`);
    assert.equal(d.motivo, 'faixa-sequestra-a-internet');
  }
});

test('rota padrão escondida no meio da lista também é pega', () => {
  const d = decidirSobreVpn({ ...bom, faixas: ['192.168.1.0/24', '0.0.0.0/0'] }, null);
  assert.equal(d.acao, 'recusar');
});

test('PROVA DE VIDA ausente é recusa — não dá para vigiar o túnel sem câmera', () => {
  const d = decidirSobreVpn({ ...bom, cameras: [] }, null);
  assert.equal(d.acao, 'recusar');
  assert.equal(d.motivo, 'prova-de-vida-ausente');
});

test('faixa mal escrita é recusada, nunca aplicada "mais ou menos"', () => {
  for (const ruim of ['192.168.1.0', '192.168.1.0/33', '300.1.1.0/24', 'rede-do-cliente']) {
    assert.equal(decidirSobreVpn({ ...bom, faixas: [ruim] }, null).acao, 'recusar', ruim);
  }
});

test('tipo desconhecido é recusado', () => {
  assert.equal(decidirSobreVpn({ ...bom, tipo: 'pptp' }, null).motivo, 'tipo-desconhecido');
});

test('os três tipos suportados são aceitos', () => {
  for (const tipo of ['l2tp-ipsec', 'wireguard', 'openvpn', 'WireGuard']) {
    assert.equal(decidirSobreVpn({ ...bom, tipo }, null).acao, 'aplicar', tipo);
  }
});

test('VPN removida na Central desmonta o túnel — mas só se havia um', () => {
  assert.deepEqual(decidirSobreVpn(null, 3), { acao: 'desmontar', motivo: 'sem-vpn' });
  assert.deepEqual(decidirSobreVpn(null, null), { acao: 'manter', motivo: 'sem-vpn' });
});
