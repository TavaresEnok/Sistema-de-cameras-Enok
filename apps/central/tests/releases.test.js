'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizarCommit,
  validarEvidencia,
  validarPromocao,
  situacaoDaInstalacao,
  resumoDaFrota,
  releaseParaInstalacao,
  registrarNoHistorico,
} = require('../src/releases');

const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const GATE_OK = { instalacaoLimpa: true, verificadaNaMatriz: true, em: '2026-08-10T12:00:00.000Z' };

test('commit só é aceito em forma imutável de 40 hex', () => {
  assert.equal(normalizarCommit(COMMIT_A.toUpperCase()), COMMIT_A, 'normaliza maiúsculas');
  assert.equal(normalizarCommit(`  ${COMMIT_A}  `), COMMIT_A);
  // Commit curto identifica hoje e pode ficar ambíguo amanhã — instalar "quase
  // o commit certo" é pior que não instalar.
  assert.equal(normalizarCommit('a'.repeat(7)), null, 'commit curto é recusado');
  assert.equal(normalizarCommit('main'), null, 'branch não é versão: ela se move');
  assert.equal(normalizarCommit(''), null);
  assert.equal(normalizarCommit(null), null);
});

test('promover EXIGE evidência de teste', () => {
  // O ponto inteiro da matriz: nada vai para a frota sem ter passado no gate.
  assert.equal(validarPromocao({ commit: COMMIT_A }).erro, 'gate_ausente');
  assert.equal(
    validarPromocao({ commit: COMMIT_A, gate: { verificadaNaMatriz: true, em: GATE_OK.em } }).erro,
    'gate_instalacao_limpa_ausente',
  );
  assert.equal(
    validarPromocao({ commit: COMMIT_A, gate: { instalacaoLimpa: true, em: GATE_OK.em } }).erro,
    'gate_matriz_ausente',
    'instalar do zero não prova que roda com dados reais',
  );
  assert.equal(
    validarPromocao({ commit: COMMIT_A, gate: { ...GATE_OK, em: 'ontem' } }).erro,
    'gate_sem_data_valida',
  );
  assert.equal(validarEvidencia(GATE_OK).ok, true);
});

test('promoção válida vira release com data e autor', () => {
  const r = validarPromocao(
    { commit: COMMIT_A, gate: GATE_OK, notas: 'perímetro por linha', promovidoPor: 'ajust@x.com' },
    { agora: new Date('2026-08-10T15:00:00.000Z') },
  );
  assert.equal(r.ok, true);
  assert.equal(r.release.commit, COMMIT_A);
  assert.equal(r.release.promovidoEm, '2026-08-10T15:00:00.000Z');
  assert.equal(r.release.promovidoPor, 'ajust@x.com');
  assert.equal(r.release.notas, 'perímetro por linha');
  assert.equal(r.release.rollback, false);
});

test('rollback dispensa gate SÓ para commit que já foi aprovado', () => {
  const historico = [{ commit: COMMIT_B }];
  // Volta para uma versão que já esteve na frota: ela já passou pelo gate.
  const volta = validarPromocao({ commit: COMMIT_B }, { historico, permitirSemGate: true });
  assert.equal(volta.ok, true);
  assert.equal(volta.release.rollback, true, 'fica marcado como rollback');

  // Novidade continua exigindo gate mesmo com a permissão ligada — senão
  // "rollback" viraria a porta dos fundos para publicar sem testar.
  const nova = validarPromocao({ commit: COMMIT_A }, { historico, permitirSemGate: true });
  assert.equal(nova.ok, false);
  assert.equal(nova.erro, 'gate_ausente');
});

test('repositório, quando informado, tem de ser HTTPS sem credencial', () => {
  const mau = validarPromocao({ commit: COMMIT_A, gate: GATE_OK, repositoryUrl: 'http://x/y.git' });
  assert.equal(mau.erro, 'repositorio_invalido');
  const comCredencial = validarPromocao({
    commit: COMMIT_A, gate: GATE_OK, repositoryUrl: 'https://user:senha@github.com/x/y.git',
  });
  assert.equal(comCredencial.erro, 'repositorio_invalido', 'credencial na URL vazaria no .env da instalação');
});

test('situação da instalação separa DESCONHECIDA de atrasada', () => {
  const release = { commit: COMMIT_A };
  assert.equal(situacaoDaInstalacao({ version: COMMIT_A }, release), 'atualizada');
  assert.equal(situacaoDaInstalacao({ version: COMMIT_B }, release), 'atrasada');
  // Nunca mandou versão (ou está fora do ar): não é atualizada nem se pode
  // empurrar às cegas. O operador precisa VER que não se sabe.
  assert.equal(situacaoDaInstalacao({ version: null }, release), 'desconhecida');
  assert.equal(situacaoDaInstalacao({}, release), 'desconhecida');
  assert.equal(situacaoDaInstalacao({ version: COMMIT_A }, null), 'sem-release');
});

test('resumo da frota conta cada instalação uma vez', () => {
  const release = { commit: COMMIT_A };
  const resumo = resumoDaFrota({
    a: { version: COMMIT_A },
    b: { version: COMMIT_B },
    c: { version: COMMIT_B },
    d: {},
  }, release);
  assert.deepEqual(resumo, {
    total: 4, atualizada: 1, atrasada: 2, desconhecida: 1, 'sem-release': 0,
  });
});

test('o que desce no heartbeat é mínimo e diz a situação daquela instalação', () => {
  const release = {
    commit: COMMIT_A, repositoryUrl: 'https://github.com/x/y.git',
    promovidoEm: '2026-08-10T15:00:00.000Z', notas: 'segredo interno', gate: GATE_OK,
  };
  const payload = releaseParaInstalacao(release, { version: COMMIT_B });
  assert.deepEqual(payload, {
    commit: COMMIT_A,
    repositoryUrl: 'https://github.com/x/y.git',
    promovidoEm: '2026-08-10T15:00:00.000Z',
    situacao: 'atrasada',
  });
  // Canal de máquina: notas e evidência não têm o que fazer na instalação.
  assert.ok(!('notas' in payload) && !('gate' in payload));
  assert.equal(releaseParaInstalacao(null, {}), null);
});

test('histórico guarda a mais nova primeiro e não duplica a mesma seguida', () => {
  let h = [];
  h = registrarNoHistorico(h, { commit: COMMIT_A, promovidoEm: '1' });
  h = registrarNoHistorico(h, { commit: COMMIT_B, promovidoEm: '2' });
  assert.deepEqual(h.map((r) => r.commit), [COMMIT_B, COMMIT_A]);

  // Re-promover o mesmo commit (ex.: corrigindo as notas) atualiza a entrada
  // em vez de encher o histórico de linhas iguais.
  h = registrarNoHistorico(h, { commit: COMMIT_B, promovidoEm: '3', notas: 'ajuste' });
  assert.equal(h.length, 2);
  assert.equal(h[0].promovidoEm, '3');
  assert.equal(h[0].notas, 'ajuste');
});

test('histórico não cresce sem limite', () => {
  let h = [];
  for (let i = 0; i < 80; i += 1) {
    h = registrarNoHistorico(h, { commit: String(i).padStart(40, '0'), promovidoEm: String(i) });
  }
  assert.equal(h.length, 50);
  assert.equal(h[0].commit, String(79).padStart(40, '0'), 'mais nova primeiro');
});
