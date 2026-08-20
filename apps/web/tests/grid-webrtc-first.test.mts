import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const SRC = readFileSync(
  join(import.meta.dirname, '..', 'src', 'components', 'LiveStreamPlayer.tsx'),
  'utf8',
);

function politicaDaGrade() {
  const inicio = SRC.indexOf("if (deliveryMode === 'grid-hevc') {", SRC.indexOf('const orderedProtocols'));
  const fim = SRC.indexOf('// Modo "Máxima qualidade"', inicio);
  assert.ok(inicio > -1 && fim > inicio, 'política de protocolos da grade não encontrada');
  return SRC.slice(inicio, fim);
}

test('grade tenta WebRTC primeiro para H.264 e H.265', () => {
  const politica = politicaDaGrade();
  assert.match(politica, /const capable: LiveProtocol\[\] = \['webrtc'\]/);
  assert.doesNotMatch(
    politica,
    /if \(deliveryMode === 'grid-hevc'\s*&&/,
    'a prioridade WebRTC não pode depender de a fonte ser H.265',
  );
});

test('HLS permanece contingência compatível com o codec', () => {
  const politica = politicaDaGrade();
  assert.match(politica, /const sourceIsHevc =/);
  assert.match(politica, /if \(!sourceIsHevc \|\| MSE_DECODES_HEVC\) capable\.push\('llhls', 'hls'\)/);
});
