import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACOES_DE_RUIDO,
  PRAZOS_PADRAO,
  classificar,
  limiteDeCorte,
  planejarLimpeza,
} from '../src/recordings/helpers/limpeza-do-historico.helper';

// "o banco deve estar cheio de alertas e alarmes, poderia fazer uma limpeza
//  também!" (dono, 27/08/2026)

test('A REGRA QUE NÃO PODE CAIR: na dúvida, guarda', () => {
  // Ação que este módulo nunca viu nasce PROTEGIDA. Sem isto, a próxima
  // funcionalidade perderia o histórico dela em silêncio.
  assert.equal(classificar('funcionalidade.que.ainda.nao.existe'), 'rastro');
  assert.equal(classificar(''), 'rastro');
  assert.equal(classificar(null), 'rastro');
  assert.equal(classificar(undefined), 'rastro');
});

test('o rastro que é PROVA nunca entra na faxina', () => {
  for (const acao of [
    'recording.play',            // quem viu qual gravação
    'auth.login.success',
    'auth.login.failed',
    'camera.create', 'camera.update', 'camera.delete',
    'camera.credential_revealed',
    'group.panic_alert',         // quem disparou o pânico
    'user.permission.change',
    'camera_group.retention_set',
  ]) {
    assert.equal(classificar(acao), 'rastro', acao);
  }
});

test('o ruído medido nesta instalação é reconhecido', () => {
  // Os três maiores, que juntos eram 165 mil das 178 mil linhas.
  assert.equal(classificar('alarm.notification.delivery'), 'ruido');
  assert.equal(classificar('stream.token.create'), 'ruido');
  assert.equal(classificar('stream.live.failure'), 'ruido');
});

test('a lista de ruído é fechada — acrescentar exige escrever o nome', () => {
  // Se este número mudar, alguém alterou a política de propósito e deve dizer
  // por quê na mensagem do commit.
  assert.equal(ACOES_DE_RUIDO.size, 8);
});

test('PRAZO ZERO NÃO APAGA TUDO', () => {
  // `Number(null)` é 0 em JavaScript, e prazo zero apagaria a base inteira na
  // primeira passagem. Já custou defeito cinco vezes neste projeto; aqui o
  // estrago seria irreversível.
  const agora = Date.parse('2026-08-27T00:00:00Z');
  for (const ruim of [null, undefined, '', 0, -5, NaN, 'abacaxi']) {
    const corte = limiteDeCorte(agora, ruim, 30);
    const dias = Math.round((agora - corte.getTime()) / 86400000);
    assert.equal(dias, 30, `entrada ${String(ruim)} deveria cair no padrão`);
  }
});

test('prazo válido é respeitado', () => {
  const agora = Date.parse('2026-08-27T00:00:00Z');
  const corte = limiteDeCorte(agora, 7, 30);
  assert.equal(Math.round((agora - corte.getTime()) / 86400000), 7);
});

test('o rastro é guardado MUITO mais tempo que o ruído', () => {
  assert.ok(PRAZOS_PADRAO.rastroDias > PRAZOS_PADRAO.ruidoDias * 20,
    'rastro precisa sobreviver a uma investigação tardia');
  assert.equal(PRAZOS_PADRAO.rastroDias, 730);
});

test('o plano sai pronto para o serviço executar', () => {
  const agora = Date.parse('2026-08-27T00:00:00Z');
  const p = planejarLimpeza(agora);
  assert.ok(p.ruidoAntesDe > p.rastroAntesDe, 'ruído some antes do rastro');
  assert.ok(p.acoesDeRuido.includes('stream.live.failure'));
  assert.equal(p.acoesDeRuido.length, 8);
});

test('dá para encurtar o prazo sem tocar no código', () => {
  const agora = Date.parse('2026-08-27T00:00:00Z');
  const p = planejarLimpeza(agora, { ruidoDias: 7, alarmeDias: 15 });
  assert.equal(Math.round((agora - p.ruidoAntesDe.getTime()) / 86400000), 7);
  assert.equal(Math.round((agora - p.alarmesAntesDe.getTime()) / 86400000), 15);
  // O que não foi informado continua no padrão.
  assert.equal(Math.round((agora - p.rastroAntesDe.getTime()) / 86400000), 730);
});
