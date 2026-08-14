import test from 'node:test';
import assert from 'node:assert/strict';
import { decidirCopiaDeVideo } from '../src/camera-stream/helpers/copia-em-vez-de-reencode.helper';

// ─────────────────────────────────────────────────────────────────────────────
// "se chegou H.264 deve mostrar H.264 sem conversão porque isso é retrabalho e
//  jogar % da cpu no lixo!!!" (dono, 14/08/2026)
//
// Medido nas 4 câmeras Grupo Flash: substream 640×360 @20 H.264 — exatamente o
// teto da grade. O filtro `scale=min(iw,640)` não mudava um pixel, e mesmo
// assim o vídeo era decodificado e reencodado.
// ─────────────────────────────────────────────────────────────────────────────

const GRADE = { larguraMaxima: 640, alturaMaxima: 360, fpsAlvo: 20 };

test('o caso real: fonte idêntica ao teto é COPIADA', () => {
  const d = decidirCopiaDeVideo({ codec: 'h264', largura: 640, altura: 360, fps: 20 }, GRADE);
  assert.equal(d.copiar, true);
  assert.equal(d.motivo, 'copia-nada-mudaria');
});

test('fonte menor que o teto também é copiada', () => {
  assert.equal(decidirCopiaDeVideo({ codec: 'h264', largura: 528, altura: 360, fps: 15 }, GRADE).copiar, true);
});

test('H.265 NUNCA passa direto — o navegador não toca no mosaico', () => {
  const d = decidirCopiaDeVideo({ codec: 'h265', largura: 640, altura: 360, fps: 20 }, GRADE);
  assert.equal(d.copiar, false);
  assert.equal(d.motivo, 'codec-incompativel');
});

test('fonte maior que o teto reencoda — é aí que o redimensionamento serve', () => {
  const d = decidirCopiaDeVideo({ codec: 'h264', largura: 1920, altura: 1080, fps: 20 }, GRADE);
  assert.equal(d.copiar, false);
  assert.equal(d.motivo, 'precisa-reduzir-tamanho');
});

test('só a altura estourando já basta para reencodar', () => {
  assert.equal(decidirCopiaDeVideo({ codec: 'h264', largura: 320, altura: 480, fps: 10 }, GRADE).copiar, false);
});

test('fonte com quadros demais reencoda — o mosaico tem orçamento de banda', () => {
  const d = decidirCopiaDeVideo({ codec: 'h264', largura: 640, altura: 360, fps: 30 }, GRADE);
  assert.equal(d.motivo, 'precisa-reduzir-quadros');
});

test('arredondamento de fps não provoca reencode à toa', () => {
  // Câmera que relata 19,97 ou 20,4 não pode custar um encode inteiro.
  for (const fps of [19.97, 20, 20.4, 21]) {
    assert.equal(decidirCopiaDeVideo({ codec: 'h264', largura: 640, altura: 360, fps }, GRADE).copiar, true, `fps ${fps}`);
  }
  assert.equal(decidirCopiaDeVideo({ codec: 'h264', largura: 640, altura: 360, fps: 25 }, GRADE).copiar, false);
});

test('fps ausente não impede a cópia — quem manda no custo é o tamanho', () => {
  assert.equal(decidirCopiaDeVideo({ codec: 'h264', largura: 640, altura: 360, fps: null }, GRADE).copiar, true);
});

test('resolução desconhecida REENCODA — não dá para afirmar que cabe', () => {
  // Errar para este lado custa CPU; errar para o outro estoura a banda do
  // mosaico ou entrega vídeo que o navegador não toca.
  for (const fonte of [
    { codec: 'h264', largura: null, altura: 360 },
    { codec: 'h264', largura: 640, altura: 0 },
    { codec: 'h264' },
  ]) {
    const d = decidirCopiaDeVideo(fonte, GRADE);
    assert.equal(d.copiar, false);
    assert.equal(d.motivo, 'fonte-desconhecida');
  }
});

test('codec vazio ou desconhecido reencoda', () => {
  assert.equal(decidirCopiaDeVideo({ codec: null, largura: 640, altura: 360 }, GRADE).copiar, false);
  assert.equal(decidirCopiaDeVideo({ codec: '', largura: 640, altura: 360 }, GRADE).copiar, false);
});

test('apelidos de H.264 são reconhecidos', () => {
  for (const codec of ['h264', 'H264', 'avc', 'avc1', ' H264 ']) {
    assert.equal(decidirCopiaDeVideo({ codec, largura: 640, altura: 360 }, GRADE).copiar, true, codec);
  }
});
