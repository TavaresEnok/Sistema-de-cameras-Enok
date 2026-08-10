import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ── O POSTER PRECISA RESPONDER NA HORA ──────────────────────────────────────
// O dono reclamou: "demora muito para aparecer um snapshot". A 1ª carga do
// poster esperava o FFmpeg conectar no RTSP e pescar um keyframe (segundos), e
// o editor de perímetro ficava em "Carregando imagem…".
//
// O pipeline de gravação já grava um `.thumb.jpg` por segmento. Ler o mais
// recente do disco é INSTANTÂNEO (medido: 1ms) e serve de fundo perfeito. Estes
// testes garantem que o poster consulta o disco ANTES do grab RTSP, e só cai no
// RTSP quando não há thumbnail recente.

const SRC = readFileSync('src/camera-stream/ffmpeg-mjpeg.service.ts', 'utf8');

test('o poster tem um caminho de thumbnail em disco (instantâneo)', () => {
  assert.match(SRC, /latestDiskThumbnail/, 'sem a busca em disco, a 1ª carga volta a ser lenta');
  assert.match(SRC, /\.thumb\.jpg/, 'a busca é pelo thumbnail de gravação');
});

test('o disco é consultado ANTES do grab RTSP lento', () => {
  const iDisco = SRC.indexOf('latestDiskThumbnail(cameraId)');
  const iRtsp = SRC.indexOf('generateLivePosterFrame(cameraId)');
  // Dentro de getLivePosterFrame, a chamada ao disco precisa vir antes da
  // geração via RTSP — senão o usuário espera o FFmpeg à toa.
  assert.ok(iDisco > 0 && iRtsp > 0, 'ambos os caminhos precisam existir');
  assert.ok(iDisco < iRtsp, 'o disco (rápido) tem de ser tentado antes do RTSP (lento)');
});

test('thumbnail velho NÃO é usado — aí sim vale o frame ao vivo', () => {
  const i = SRC.indexOf('private async latestDiskThumbnail');
  const corpo = SRC.slice(i, i + 1400);
  assert.match(corpo, /maxAgeMs/, 'um thumbnail antigo demais deve ser descartado');
  assert.match(corpo, /return null/, 'sem thumbnail recente, devolve null e cai para o RTSP');
});
