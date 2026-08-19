'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { configuredInstallerArtifact } = require('../src/installer-security');
const { validarPromocao } = require('../src/releases');

// ─────────────────────────────────────────────────────────────────────────────
// Defeito encontrado em 19/08/2026 validando a instalação pela Central:
// promover uma versão devolvia HTTP 200, gravava a release — e o comando de
// instalação continuava apontando para o commit ANTIGO.
//
// O artefato lia SÓ variáveis de ambiente, então "promover" e "instalar" eram
// dois sistemas desligados. O gate de qualidade não protegia nada: o que a
// Central mandava instalar nunca passava por ele.
// ─────────────────────────────────────────────────────────────────────────────

const ANTIGO = 'cffb2fe4c98e87a0c113e1fd0a8a6647afb7c4e7';
const NOVO   = '4e297b83233124ad5a62914df46d80f64aadff14';
const SHA_ANTIGO = '73862148346fed8494ab89f83c7068443ad5d09ef4f8e4fc9b7a1da659291c4f';
const SHA_NOVO   = '18b58202d5308fc6f998cc7660c2bd2165c0ac35263589b6686cec886fb57206';

const AMBIENTE = {
  DRAC_CENTRAL_INSTALLER_COMMIT: ANTIGO,
  DRAC_CENTRAL_INSTALLER_SHA256: SHA_ANTIGO,
};

test('o RELEASE promovido manda no artefato — não o ambiente', () => {
  const a = configuredInstallerArtifact(AMBIENTE, new Date(), {
    commit: NOVO,
    installerSha256: SHA_NOVO,
  });
  assert.equal(a.id, NOVO, 'o comando instalaria o commit antigo — era o defeito');
  assert.equal(a.sha256, SHA_NOVO);
  assert.ok(a.url.includes(NOVO), 'a URL precisa apontar para o commit aprovado');
});

test('sem release, o ambiente serve de SEMENTE', () => {
  // A primeira instalação acontece antes de existir qualquer promoção.
  const a = configuredInstallerArtifact(AMBIENTE, new Date(), null);
  assert.equal(a.id, ANTIGO);
});

test('release sem hash cai no hash do ambiente, e não fica sem prova', () => {
  // Meia informação não pode virar artefato sem SHA: o comando gerado verifica
  // o hash antes de executar, e sem ele a verificação seria vazia.
  const a = configuredInstallerArtifact(AMBIENTE, new Date(), { commit: NOVO });
  assert.equal(a.id, NOVO);
  assert.equal(a.sha256, SHA_ANTIGO);
});

test('a promoção PRESERVA o hash do instalador', () => {
  // Ele era descartado: a release sabia qual versão foi aprovada e não sabia
  // provar o script que a instala.
  const r = validarPromocao({
    commit: NOVO,
    installerSha256: SHA_NOVO,
    gate: { instalacaoLimpa: true, verificadaNaMatriz: true, em: new Date().toISOString() },
  });
  assert.equal(r.ok, true);
  assert.equal(r.release.installerSha256, SHA_NOVO);
});

test('hash ausente na promoção vira null, nunca string vazia', () => {
  const r = validarPromocao({
    commit: NOVO,
    gate: { instalacaoLimpa: true, verificadaNaMatriz: true, em: new Date().toISOString() },
  });
  assert.equal(r.release.installerSha256, null);
});
