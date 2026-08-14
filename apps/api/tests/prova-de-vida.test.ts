import test from 'node:test';
import assert from 'node:assert/strict';
import { decidirEstadoDaCamera, devoSondarRtsp } from '../src/cameras/helpers/prova-de-vida.helper';

// ─────────────────────────────────────────────────────────────────────────────
// Relatado em 14/08/2026, com print: imagem na tela e rótulo "Offline".
//
//   "Camera mercusys fica caindo direto no sistema mas no app dela e em outro
//    sistema roda normal, deve ter alguma incompatibilidade!!!"
//
// Medido no equipamento, com o MediaMTX já puxando: três sondas seguidas
// levaram "Operation not permitted". A câmera aceita UMA sessão RTSP. O vigia
// abria a segunda a cada minuto e chamava a recusa de "câmera caiu".
// ─────────────────────────────────────────────────────────────────────────────

test('câmera transmitindo está ONLINE, ainda que a sonda tenha sido recusada', () => {
  // O defeito exato do print. A sonda testa se a câmera aceita MAIS UMA
  // conexão — que é outra pergunta, e a errada.
  const v = decidirEstadoDaCamera({
    transmitindoAgora: true,
    rtspAlcancavel: true,
    autenticacaoRtspOk: false,
    onvifAlcancavel: false,
    temCredencial: true,
  });
  assert.equal(v.status, 'ONLINE');
  assert.equal(v.motivo, 'transmitindo');
});

test('transmissão vence até quando NADA mais responde', () => {
  const v = decidirEstadoDaCamera({ transmitindoAgora: true, rtspAlcancavel: false, onvifAlcancavel: false });
  assert.equal(v.status, 'ONLINE', 'quadros chegando é a prova mais forte que existe');
});

test('sem transmissão, a decisão volta a depender das sondas', () => {
  const v = decidirEstadoDaCamera({
    transmitindoAgora: false,
    rtspAlcancavel: true,
    onvifAlcancavel: true,
    autenticacaoRtspOk: true,
    temCredencial: true,
  });
  assert.equal(v.status, 'ONLINE');
  assert.equal(v.motivo, 'sondas-ok');
});

test('sem saber se transmite, não inventa: cai nas sondas', () => {
  // MediaMTX fora do ar devolve null/undefined. Tratar isso como "não
  // transmite" seria inventar uma queda; tratar como "transmite" esconderia
  // uma real. A saída honesta é decidir pelo que dá para medir.
  for (const desconhecido of [null, undefined]) {
    const v = decidirEstadoDaCamera({
      transmitindoAgora: desconhecido,
      rtspAlcancavel: true, onvifAlcancavel: true, autenticacaoRtspOk: true, temCredencial: true,
    });
    assert.equal(v.status, 'ONLINE');
    assert.equal(v.motivo, 'sondas-ok');
  }
});

test('porta de vídeo muda: aí sim está fora do ar', () => {
  const v = decidirEstadoDaCamera({ transmitindoAgora: false, rtspAlcancavel: false });
  assert.equal(v.status, 'OFFLINE');
  assert.equal(v.motivo, 'sem-rtsp');
  assert.match(v.explicacao, /porta de vídeo/i);
});

test('senha recusada NÃO se confunde com câmera fora do ar', () => {
  // O equipamento está lá e respondeu. O conserto é a senha, e a tela precisa
  // dizer isso — senão alguém vai procurar cabo e energia.
  const v = decidirEstadoDaCamera({
    transmitindoAgora: false, rtspAlcancavel: true, autenticacaoRtspOk: false, temCredencial: true, onvifAlcancavel: true,
  });
  assert.equal(v.motivo, 'credencial-recusada');
  assert.match(v.explicacao, /usuário e a senha/i);
});

test('câmera sem credencial cadastrada não é reprovada por autenticação', () => {
  const v = decidirEstadoDaCamera({
    transmitindoAgora: false, rtspAlcancavel: true, onvifAlcancavel: true, temCredencial: false,
  });
  assert.equal(v.status, 'ONLINE');
});

test('ONVIF fechado explica que o vídeo respondeu — não some com a informação', () => {
  const v = decidirEstadoDaCamera({
    transmitindoAgora: false, rtspAlcancavel: true, autenticacaoRtspOk: true, temCredencial: true, onvifAlcancavel: false,
  });
  assert.equal(v.motivo, 'sem-onvif');
  assert.match(v.explicacao, /respondeu no vídeo/i);
});

test('não sondar quem já está transmitindo — a sonda é a segunda sessão', () => {
  // É a linha que resolve o caso do dono: parar de disputar a vaga única.
  assert.equal(devoSondarRtsp(true), false);
  assert.equal(devoSondarRtsp(false), true);
  assert.equal(devoSondarRtsp(null), true, 'sem informação, sondar é o certo');
  assert.equal(devoSondarRtsp(undefined), true);
});
