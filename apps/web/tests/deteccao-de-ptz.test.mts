import assert from 'node:assert/strict';
import test from 'node:test';
import {
  situacaoDeDeteccao,
  candidatasParaTeste,
  explicarResultadoDoTeste,
} from '../src/lib/deteccao-de-ptz.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Relatado em 14/08/2026, com duas câmeras NOC ONLINE e nunca sondadas:
//
//   "eu tenho uma camera com ptz mas nao aparece na pagina ptz e a pagina me
//    impede de colocar alguma camera manualmente ... pagina confusa muita
//    informação também"
//
// A tela dava UM motivo para todas — "estão fora do ar" — e as dele estavam no
// ar. Errar o motivo justamente para quem foi procurar explicação é pior que
// não explicar.
// ─────────────────────────────────────────────────────────────────────────────

test('câmera ONLINE nunca sondada não pode ser chamada de "fora do ar"', () => {
  const s = situacaoDeDeteccao({ id: 'c1', name: 'NOC Cam-01', isOnline: true, ptzDetectado: null });
  assert.equal(s.chave, 'nunca-sondada-online');
  assert.doesNotMatch(s.motivo, /fora do ar/i, 'o defeito original: motivo errado para câmera no ar');
  assert.equal(s.podeTestar, true, 'é justamente a que dá para testar agora');
});

test('câmera OFFLINE nunca sondada explica que o teste precisa dela no ar', () => {
  const s = situacaoDeDeteccao({ id: 'c2', name: 'NOC Cam-03', isOnline: false, ptzDetectado: null });
  assert.equal(s.chave, 'nunca-sondada-offline');
  assert.equal(s.podeTestar, false, 'oferecer teste que vai falhar é perder a confiança do operador');
});

test('câmera já verificada sem PTZ ainda pode ser testada de novo', () => {
  // O sistema pode estar errado — senha ONVIF corrigida depois, equipamento
  // trocado no mesmo cadastro. Foi o argumento do dono.
  const s = situacaoDeDeteccao({ id: 'c3', name: 'Cam-10', isOnline: true, ptzDetectado: false });
  assert.equal(s.chave, 'sondada-sem-ptz');
  assert.equal(s.podeTestar, true);
});

test('câmera desativada não oferece teste', () => {
  const s = situacaoDeDeteccao({ id: 'c4', name: 'Cam-99', enabled: false, ptzDetectado: null });
  assert.equal(s.chave, 'desativada');
  assert.equal(s.podeTestar, false);
  assert.match(s.motivo, /Reative/i, 'não diz o que fazer');
});

test('as candidatas vêm na ordem que ajuda: no ar e sem verificação primeiro', () => {
  const lista = candidatasParaTeste([
    { id: 'd', name: 'Desativada', enabled: false, ptzDetectado: null },
    { id: 'b', name: 'Sem PTZ', isOnline: true, ptzDetectado: false },
    { id: 'a', name: 'Nunca no ar', isOnline: true, ptzDetectado: null },
    { id: 'c', name: 'Nunca offline', isOnline: false, ptzDetectado: null },
  ]);
  assert.deepEqual(lista.map((c) => c.id), ['a', 'b', 'c', 'd']);
});

test('quem JÁ tem PTZ some da lista de teste', () => {
  const lista = candidatasParaTeste([
    { id: 'ok', name: 'Já tem', isOnline: true, ptzDetectado: true },
    { id: 'x', name: 'Não tem', isOnline: true, ptzDetectado: false },
  ]);
  assert.deepEqual(lista.map((c) => c.id), ['x']);
});

test('teste bem-sucedido diz que a câmera já entrou na lista', () => {
  const r = explicarResultadoDoTeste({ sondou: true, ptzCapable: true });
  assert.equal(r.sucesso, true);
  assert.match(r.detalhe, /j[áa] aparece na lista/i);
});

test('a tela NÃO afirma que a câmera disse não ter PTZ', () => {
  // Ela afirmava. A sonda tenta vários endereços e desiste — não sabe separar
  // "conversei e não há PTZ" de "nenhuma porta ONVIF respondeu". Foi o que o
  // dono viu com a Mercusys, depois de cadastrar uma porta que aceitava TCP e
  // não falava ONVIF.
  const r = explicarResultadoDoTeste({ sondou: true, ptzCapable: false });
  assert.equal(r.sucesso, false);
  assert.doesNotMatch(r.titulo, /respondeu que não tem/i, 'afirma algo que ninguém disse');
  assert.match(r.titulo, /Não encontrei/i);
  assert.match(r.detalhe, /encaminhada/, 'não explica a pegadinha do roteador — o caso real');
  assert.match(r.detalhe, /usuário ONVIF próprio/, 'não menciona o usuário ONVIF separado');
  assert.match(r.detalhe, /à mão/, 'não oferece a saída manual');
});

test('falha de rede NÃO é "não tem PTZ"', () => {
  // Confundir os dois faria o operador desistir de uma câmera boa.
  const r = explicarResultadoDoTeste({ sondou: false, motivo: 'falha-na-sonda' });
  assert.match(r.detalhe, /NÃO significa que ela não tem PTZ/i);
});

test('já definido à mão explica que a decisão do operador vence', () => {
  const r = explicarResultadoDoTeste({ sondou: false, motivo: 'definido-manualmente' });
  assert.match(r.titulo, /à mão/i);
  assert.match(r.detalhe, /vence/i);
});

test('motivo desconhecido não vira mensagem vazia', () => {
  const r = explicarResultadoDoTeste({ sondou: false, motivo: 'motivo-que-ainda-nao-existe' });
  assert.ok(r.titulo.length > 0 && r.detalhe.length > 0);
  assert.match(r.detalhe, /motivo-que-ainda-nao-existe/, 'mostrar o cru é melhor que fingir');
});

test('resposta vazia do servidor não quebra a tela', () => {
  const r = explicarResultadoDoTeste({} as never);
  assert.equal(r.sucesso, false);
  assert.ok(r.detalhe.length > 0);
});

