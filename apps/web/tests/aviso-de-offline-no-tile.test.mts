import test from 'node:test';
import assert from 'node:assert/strict';
import { mostrarAvisoDeOffline, playerTemImagemViva } from '../src/lib/aviso-de-offline-no-tile.ts';

// IBTelecom, 18/09/2026, logo após reiniciar as VMs: tag "Offline" escura por
// ~2 minutos sobre câmeras cujo vídeo rodava por trás. O player tocava por
// CONTINGÊNCIA (`fallback`) e a regra só aceitava `playing` como prova de vida.

test('o caso real: sondagem diz offline, player toca por contingência → SEM aviso', () => {
  assert.equal(mostrarAvisoDeOffline('offline', 'fallback'), false);
});

test('tocando normalmente também vence a sondagem atrasada', () => {
  assert.equal(mostrarAvisoDeOffline('offline', 'playing'), false);
  assert.equal(mostrarAvisoDeOffline('no_signal', 'playing'), false);
});

test('offline de verdade: sondagem diz offline e o player não tem imagem → aviso', () => {
  for (const estado of ['loading', 'error', null, undefined] as const) {
    assert.equal(mostrarAvisoDeOffline('offline', estado), true, String(estado));
  }
  assert.equal(mostrarAvisoDeOffline('no_signal', 'error'), true);
});

test('câmera online pela sondagem nunca recebe o aviso, mesmo com player em erro', () => {
  // Erro de player com câmera online é outro problema, com mensagem própria
  // do player — não pode virar "Offline".
  assert.equal(mostrarAvisoDeOffline('online', 'error'), false);
  assert.equal(mostrarAvisoDeOffline('recording', 'loading'), false);
});

test('imagem viva: playing e fallback sim; loading e error não', () => {
  assert.equal(playerTemImagemViva('playing'), true);
  assert.equal(playerTemImagemViva('fallback'), true);
  assert.equal(playerTemImagemViva('loading'), false);
  assert.equal(playerTemImagemViva('error'), false);
});
