import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliarEstadoDaIa } from '../src/health/helpers/estado-da-ia.helper';

// Incidente Vibe (18/09/2026): 34 câmeras marcadas com IA, zero analisadas, 241
// avisos de "detector cego" em 24 h — e o painel de prontidão verde, porque ele
// só olhava se a câmera estava MARCADA, nunca se alguém a estava analisando.

test('câmera marcada + sincronização desligada = o defeito que ficava escondido', () => {
  const r = avaliarEstadoDaIa({
    camerasComIa: 34,
    totalDeCameras: 34,
    sincronizacaoAutomatica: false,
    perfilDeLancamento: 'standard',
  });
  assert.equal(r.status, 'attention', 'antes isto era "ok" e o problema durava semanas');
  assert.match(r.detail, /AI_AUTO_START_ENABLED=false/, 'a frase precisa dizer O QUE desligar/ligar');
  assert.match(r.detail, /nenhum detector/i);
});

test('o perfil standard sem IA nenhuma continua sendo estado legítimo', () => {
  const r = avaliarEstadoDaIa({
    camerasComIa: 0,
    totalDeCameras: 12,
    sincronizacaoAutomatica: false,
    perfilDeLancamento: 'standard',
  });
  assert.equal(r.status, 'ok');
  assert.match(r.detail, /perfil de lancamento standard/);
});

test('com sincronização ligada, o painel volta a olhar só a marcação', () => {
  assert.deepEqual(
    avaliarEstadoDaIa({ camerasComIa: 34, totalDeCameras: 34, sincronizacaoAutomatica: true }),
    { status: 'ok', detail: '34/34 cameras com IA habilitada.' },
  );
  assert.equal(
    avaliarEstadoDaIa({ camerasComIa: 0, totalDeCameras: 34, sincronizacaoAutomatica: true }).status,
    'attention',
    'ninguém marcado com a sincronização ligada segue merecendo atenção',
  );
});

test('fora do perfil standard, nada marcado e sincronização desligada pede atenção', () => {
  const r = avaliarEstadoDaIa({
    camerasComIa: 0,
    totalDeCameras: 8,
    sincronizacaoAutomatica: false,
    perfilDeLancamento: 'custom',
  });
  assert.equal(r.status, 'attention');
});

test('leitura ausente ou suja não derruba o painel', () => {
  const r = avaliarEstadoDaIa({
    camerasComIa: Number.NaN,
    totalDeCameras: Number.NaN,
    sincronizacaoAutomatica: undefined as unknown as boolean,
  });
  assert.equal(r.status, 'attention', 'sem câmera marcada, atenção — nunca um "ok" por omissão');
  assert.match(r.detail, /0\/0/);
});
