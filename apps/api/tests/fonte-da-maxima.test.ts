import test from 'node:test';
import assert from 'node:assert/strict';
import { decidirFonteDaMaxima } from '../src/camera-stream/helpers/fonte-da-maxima.helper';

// ─────────────────────────────────────────────────────────────────────────────
// "quando mudo também do instantâneo ou equilibrado para máximo fica tudo preto
//  sem vídeo" (dono, 14/08/2026)
//
// Medido: o caminho da Máxima (_orig) tinha `source: rtsp://…@camera`, enquanto
// os outros dois eram `source: publisher`. Trocar de modo mandava o servidor de
// mídia discar de novo, em paralelo com o ffmpeg que já puxava. A câmera aceita
// UMA sessão: recusa, zero byte, tela preta.
// ─────────────────────────────────────────────────────────────────────────────

const CAMERA = 'rtsp://u:p@168.194.15.82:8554/h264/ch1/main/av_stream';
const INTERNA = 'rtsp://127.0.0.1:8554/cam_06cfe5309a5b4c54b5523a2ac02b0106';

test('nada aberto: a Máxima disca na câmera e entrega o original', () => {
  const d = decidirFonteDaMaxima({
    urlDaCamera: CAMERA, urlDaPublicacao: INTERNA,
    publicacaoAoVivo: false, publicacaoEhCopiaCrua: true,
  });
  assert.equal(d.url, CAMERA);
  assert.equal(d.motivo, 'sem-fonte-aberta');
  assert.equal(d.fidelidadeOriginal, true);
});

test('o caso do print: publicação aberta e câmera de sessão única → reaproveita', () => {
  const d = decidirFonteDaMaxima({
    urlDaCamera: CAMERA, urlDaPublicacao: INTERNA,
    publicacaoAoVivo: true, publicacaoEhCopiaCrua: true, aceitaSegundaSessao: false,
  });
  assert.equal(d.url, INTERNA, 'discar de novo é exatamente o que dá tela preta');
  assert.equal(d.motivo, 'reaproveita-publicacao');
  assert.equal(d.fidelidadeOriginal, true, 'cópia crua É o original');
});

test('reaproveitar publicação CONVERTIDA mostra imagem, mas não promete "máxima"', () => {
  // Preto é o pior resultado para quem só quer ver. Mostrar o que há é melhor —
  // desde que o rótulo não minta sobre a qualidade.
  const d = decidirFonteDaMaxima({
    urlDaCamera: CAMERA, urlDaPublicacao: INTERNA,
    publicacaoAoVivo: true, publicacaoEhCopiaCrua: false, aceitaSegundaSessao: false,
  });
  assert.equal(d.url, INTERNA);
  assert.equal(d.fidelidadeOriginal, false);
});

test('câmera que comprovadamente aceita 2 sessões continua entregando o original', () => {
  // A maioria aceita. Reaproveitar sempre degradaria a Máxima dessas para o
  // mesmo que o Equilibrado — regressão para quem não tem o problema.
  const d = decidirFonteDaMaxima({
    urlDaCamera: CAMERA, urlDaPublicacao: INTERNA,
    publicacaoAoVivo: true, publicacaoEhCopiaCrua: false, aceitaSegundaSessao: true,
  });
  assert.equal(d.url, CAMERA);
  assert.equal(d.motivo, 'camera-aceita-segunda-sessao');
  assert.equal(d.fidelidadeOriginal, true);
});

test('sem saber se aceita, NÃO arrisca a segunda conexão', () => {
  // Errar para o lado de discar custa tela preta; errar para o lado de
  // reaproveitar custa, no pior caso, qualidade — e o rótulo avisa.
  for (const desconhecido of [null, undefined]) {
    const d = decidirFonteDaMaxima({
      urlDaCamera: CAMERA, urlDaPublicacao: INTERNA,
      publicacaoAoVivo: true, publicacaoEhCopiaCrua: true, aceitaSegundaSessao: desconhecido,
    });
    assert.equal(d.url, INTERNA);
  }
});

test('publicação sem URL não vira origem vazia', () => {
  // Origem vazia no servidor de mídia é caminho que nunca abre — outra tela
  // preta, por outro caminho.
  for (const vazia of [null, undefined, '', '   ']) {
    const d = decidirFonteDaMaxima({
      urlDaCamera: CAMERA, urlDaPublicacao: vazia,
      publicacaoAoVivo: true, publicacaoEhCopiaCrua: true, aceitaSegundaSessao: false,
    });
    assert.equal(d.url, CAMERA);
    assert.equal(d.motivo, 'sem-fonte-aberta');
  }
});
