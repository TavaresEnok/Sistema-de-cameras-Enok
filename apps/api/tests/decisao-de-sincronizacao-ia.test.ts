import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirSincronizacaoDeIa } from '../src/ai/helpers/decisao-de-sincronizacao.helper';

// Incidente de 18/09/2026, duas instalações ao mesmo tempo: a Central liberava
// movimento (ai-policy.js nasce com `motion: true`) e o `.env` local trazia
// AI_AUTO_START_ENABLED=false — herdado do .env.example. A instalação obedecia
// o arquivo e ignorava a Central em silêncio: nenhuma câmera analisada.
//   Vibe: 34 marcadas, 0 analisadas, 241 avisos de "detector cego" em 24 h.
//   IBTelecom: 7 marcadas, 0 analisadas, última detecção 16 dias antes.

test('flag local desligada COM câmera marcada: sincroniza assim mesmo e avisa alto', () => {
  const d = decidirSincronizacaoDeIa({
    flagLocalLigada: false,
    camerasMarcadas: 34,
    movimentoPermitidoPelaCentral: true,
  });
  assert.equal(d.sincronizar, true, 'câmera armada sem detector é o pior estado possível');
  assert.equal(d.nivel, 'warn', 'contradição entre Central e .env não pode passar calada');
  assert.match(d.motivo, /AI_AUTO_START_ENABLED=false/);
  assert.match(d.motivo, /desmarque a IA nas câmeras/, 'a frase precisa dizer como desligar de verdade');
});

test('flag local desligada SEM câmera marcada: respeita, é coerente', () => {
  const d = decidirSincronizacaoDeIa({
    flagLocalLigada: false,
    camerasMarcadas: 0,
    movimentoPermitidoPelaCentral: true,
  });
  assert.equal(d.sincronizar, false);
  assert.equal(d.nivel, 'log', 'instalação sem IA nenhuma não é defeito');
});

test('a Central manda mais que o .env: movimento proibido nunca sincroniza', () => {
  for (const flagLocalLigada of [true, false]) {
    const d = decidirSincronizacaoDeIa({
      flagLocalLigada,
      camerasMarcadas: 40,
      movimentoPermitidoPelaCentral: false,
    });
    assert.equal(d.sincronizar, false, `flag local ${flagLocalLigada} não pode furar a política comercial`);
    assert.match(d.motivo, /Central/);
  }
});

test('caso normal: sincroniza sem alarde', () => {
  const d = decidirSincronizacaoDeIa({
    flagLocalLigada: true,
    camerasMarcadas: 12,
    movimentoPermitidoPelaCentral: true,
  });
  assert.equal(d.sincronizar, true);
  assert.equal(d.nivel, 'log');
});

test('leitura ausente não inventa proibição', () => {
  const d = decidirSincronizacaoDeIa({
    flagLocalLigada: undefined as unknown as boolean,
    camerasMarcadas: Number.NaN,
    movimentoPermitidoPelaCentral: undefined as unknown as boolean,
  });
  assert.equal(d.sincronizar, true, 'sem informação, o padrão do produto é a IA ligada');
});
