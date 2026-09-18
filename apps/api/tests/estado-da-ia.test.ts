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

// ── Modelo de objeto ausente (medido em 18/09/2026) ────────────────────────
// Vibe e IBTelecom rodavam com a pasta `/app/models` VAZIA: detecção de objeto
// era impossível nas duas, e o painel não dizia nada. A pasta é um volume do
// host — instalar o sistema não instala os modelos.

test('modo objeto com a pasta de modelos vazia vira atencao', () => {
  const r = avaliarEstadoDaIa({
    camerasComIa: 34,
    totalDeCameras: 34,
    sincronizacaoAutomatica: true,
    modoDeIa: 'general',
    modeloDeObjetoInstalado: false,
  });
  assert.equal(r.status, 'attention');
  assert.match(r.detail, /modelo nao esta instalado/i);
  assert.match(r.detail, /infra\/ai-models/, 'a frase precisa dizer onde resolver');
});

test('modo movimento sem modelo NAO e defeito, mas avisa o que deixa de existir', () => {
  // O detector de movimento não usa modelo nenhum; pintar de vermelho aqui
  // seria alarme falso. O que se perde é a confirmação por objeto.
  const r = avaliarEstadoDaIa({
    camerasComIa: 3,
    totalDeCameras: 35,
    sincronizacaoAutomatica: true,
    modoDeIa: 'motion',
    modeloDeObjetoInstalado: false,
  });
  assert.equal(r.status, 'ok');
  assert.match(r.detail, /confirmacao por objeto nao roda/i);
  assert.match(r.detail, /movimento segue funcionando/i);
});

test('nao saber se o modelo existe nunca vira acusacao', () => {
  // Serviço de IA fora do ar ou versão antiga sem o campo: a leitura é null.
  for (const modo of ['general', 'motion']) {
    const r = avaliarEstadoDaIa({
      camerasComIa: 10,
      totalDeCameras: 10,
      sincronizacaoAutomatica: true,
      modoDeIa: modo,
      modeloDeObjetoInstalado: null,
    });
    assert.equal(r.status, 'ok', `modo ${modo}: incerteza nao e defeito`);
    assert.ok(!/modelo/i.test(r.detail), 'sem leitura, nao se fala de modelo');
  }
});

test('os dois problemas juntos: a frase diz OS DOIS, nao um no lugar do outro', () => {
  // Foi exatamente o estado da Vibe em 18/09/2026. Se uma mensagem substitui a
  // outra, quem le o painel conserta metade e acha que acabou.
  const r = avaliarEstadoDaIa({
    camerasComIa: 34,
    totalDeCameras: 34,
    sincronizacaoAutomatica: false,
    modoDeIa: 'general',
    modeloDeObjetoInstalado: false,
  });
  assert.equal(r.status, 'attention');
  assert.match(r.detail, /AI_AUTO_START_ENABLED=false/, 'o pior problema vem primeiro: nada armando');
  assert.match(r.detail, /modelo NAO esta instalado/i, 'e o modelo ausente nao pode sumir da frase');
});
