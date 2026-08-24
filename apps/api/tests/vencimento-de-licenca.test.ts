import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIAS_ATE_RESTRINGIR,
  DIAS_ATE_SUSPENDER,
  combinarEstados,
  decidirLicenca,
  diasSemContato,
  estadoPorSilencio,
} from '../src/commercial-policy/helpers/vencimento-de-licenca.helper';

// ─────────────────────────────────────────────────────────────────────────────
// "vamos supor que a pessoa retire a VM da internet e tente rodar o sistema sem
//  pagar" (dono, 24/08/2026)
//
// Era possível: sem contato, a instalação só anotava o erro no log e seguia, e
// o estado `UNKNOWN` — o de quem nunca falou com a Central — liberava TUDO.
// ─────────────────────────────────────────────────────────────────────────────

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.UTC(2026, 7, 24, 12, 0, 0);
const haDias = (d: number) => AGORA - d * DIA;

test('O CASO REAL: tirar da internet restringe em 10 dias e suspende em 15', () => {
  const emDia = decidirLicenca({ estadoDaCentral: 'ACTIVE', ultimoContatoMs: haDias(9), agoraMs: AGORA });
  assert.equal(emDia.estado, 'ACTIVE');

  const restrito = decidirLicenca({ estadoDaCentral: 'ACTIVE', ultimoContatoMs: haDias(10), agoraMs: AGORA });
  assert.equal(restrito.estado, 'RESTRICTED');
  assert.equal(restrito.motivo, 'silencio-restringiu');

  const suspenso = decidirLicenca({ estadoDaCentral: 'ACTIVE', ultimoContatoMs: haDias(15), agoraMs: AGORA });
  assert.equal(suspenso.estado, 'SUSPENDED');
  assert.equal(suspenso.motivo, 'silencio-suspendeu');
});

test('NUNCA ter falado com a Central é o PIOR caso, não o melhor', () => {
  // Era o inverso: `UNKNOWN` liberava tudo, então instalação virgem rodava solta.
  for (const semContato of [null, undefined, 0, -1]) {
    const d = decidirLicenca({ estadoDaCentral: 'UNKNOWN', ultimoContatoMs: semContato as number, agoraMs: AGORA });
    assert.equal(d.estado, 'SUSPENDED', `sem contato (${semContato}) deveria suspender`);
    assert.equal(d.motivo, 'nunca-falou');
  }
});

test('atrasar o relógio da máquina NÃO devolve dias de licença', () => {
  // A forma óbvia de burlar prazo. A conta usa o maior instante já observado.
  const relogioAtrasado = AGORA - 60 * DIA;
  const d = decidirLicenca({
    estadoDaCentral: 'ACTIVE',
    ultimoContatoMs: haDias(20),
    agoraMs: relogioAtrasado,
    maiorInstanteVistoMs: AGORA,
  });
  assert.equal(d.estado, 'SUSPENDED');
});

test('sem a marca do maior instante, o relógio atrasado ainda não vira crédito', () => {
  // Piso mínimo: o próprio último contato. Nunca dá negativo.
  const d = diasSemContato(haDias(20), AGORA - 100 * DIA);
  assert.ok(d >= 0);
});

test('o estado da CENTRAL e o do SILÊNCIO não se anulam — vale o pior', () => {
  // Central restringiu por contrato, mas a instalação fala todo dia.
  const soCentral = decidirLicenca({ estadoDaCentral: 'RESTRICTED', ultimoContatoMs: haDias(1), agoraMs: AGORA });
  assert.equal(soCentral.estado, 'RESTRICTED');

  // Central achava tudo bem, mas ninguém fala há 20 dias.
  const soSilencio = decidirLicenca({ estadoDaCentral: 'ACTIVE', ultimoContatoMs: haDias(20), agoraMs: AGORA });
  assert.equal(soSilencio.estado, 'SUSPENDED');

  // Central suspendeu; o silêncio não pode AMENIZAR isso.
  const centralPior = decidirLicenca({ estadoDaCentral: 'SUSPENDED', ultimoContatoMs: haDias(0), agoraMs: AGORA });
  assert.equal(centralPior.estado, 'SUSPENDED');
});

test('combinarEstados nunca escolhe o mais brando', () => {
  assert.equal(combinarEstados('ACTIVE', 'RESTRICTED'), 'RESTRICTED');
  assert.equal(combinarEstados('SUSPENDED', 'ACTIVE'), 'SUSPENDED');
  assert.equal(combinarEstados('ACTIVE', 'ACTIVE'), 'ACTIVE');
});

test('o operador é avisado ANTES do primeiro corte', () => {
  // Sistema que morre de surpresa vira chamado de suporte e cliente irritado.
  assert.equal(decidirLicenca({ estadoDaCentral: 'ACTIVE', ultimoContatoMs: haDias(3), agoraMs: AGORA }).avisar, false);
  assert.equal(decidirLicenca({ estadoDaCentral: 'ACTIVE', ultimoContatoMs: haDias(7), agoraMs: AGORA }).avisar, true);
});

test('mostra quantos dias faltam para o próximo corte', () => {
  const a = decidirLicenca({ estadoDaCentral: 'ACTIVE', ultimoContatoMs: haDias(8), agoraMs: AGORA });
  assert.equal(a.diasAteOProximoCorte, DIAS_ATE_RESTRINGIR - 8);

  const b = decidirLicenca({ estadoDaCentral: 'ACTIVE', ultimoContatoMs: haDias(12), agoraMs: AGORA });
  assert.equal(b.diasAteOProximoCorte, DIAS_ATE_SUSPENDER - 12);

  const c = decidirLicenca({ estadoDaCentral: 'ACTIVE', ultimoContatoMs: haDias(30), agoraMs: AGORA });
  assert.equal(c.diasAteOProximoCorte, null, 'já suspenso não tem próximo corte');
});

test('voltar a falar com a Central restaura na hora', () => {
  const d = decidirLicenca({ estadoDaCentral: 'ACTIVE', ultimoContatoMs: AGORA, agoraMs: AGORA });
  assert.equal(d.estado, 'ACTIVE');
  assert.equal(d.diasSemContato, 0);
  assert.equal(d.avisar, false);
});

test('as fronteiras exatas dos prazos', () => {
  assert.equal(estadoPorSilencio(9.99), 'ACTIVE');
  assert.equal(estadoPorSilencio(10), 'RESTRICTED');
  assert.equal(estadoPorSilencio(14.99), 'RESTRICTED');
  assert.equal(estadoPorSilencio(15), 'SUSPENDED');
  assert.equal(estadoPorSilencio(Number.POSITIVE_INFINITY), 'SUSPENDED');
});
