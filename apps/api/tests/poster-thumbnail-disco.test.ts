import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FfmpegMjpegService } from '../src/camera-stream/ffmpeg-mjpeg.service';

// ── O POSTER PRECISA RESPONDER NA HORA ──────────────────────────────────────
// O dono reclamou: "demora muito para aparecer um snapshot". A 1ª carga do
// poster esperava o FFmpeg conectar no RTSP e pescar um keyframe (segundos), e
// o editor de perímetro ficava em "Carregando imagem…".
//
// O pipeline de gravação já grava um `.thumb.jpg` por segmento. Ler o mais
// recente do disco é INSTANTÂNEO (medido: 1ms) e serve de fundo perfeito. Estes
// testes garantem que o poster consulta o disco ANTES do grab RTSP e inicia a
// atualização ao vivo sem deixar o usuário preso nessa imagem de fallback.

const SRC = readFileSync('src/camera-stream/ffmpeg-mjpeg.service.ts', 'utf8');

test('o poster tem um caminho de thumbnail em disco (instantâneo)', () => {
  assert.match(SRC, /latestDiskThumbnail/, 'sem a busca em disco, a 1ª carga volta a ser lenta');
  assert.match(SRC, /\.thumb\.jpg/, 'a busca é pelo thumbnail de gravação');
});

test('o disco é consultado ANTES do grab RTSP lento', () => {
  const inicio = SRC.indexOf('async getLivePosterFrame');
  const corpo = SRC.slice(inicio, inicio + 1800);
  const iDisco = corpo.indexOf('latestDiskThumbnail(cameraId)');
  const iRtsp = corpo.indexOf('refreshLivePoster(cameraId, cached)');
  // Dentro de getLivePosterFrame, a chamada ao disco precisa vir antes da
  // geração via RTSP — senão o usuário espera o FFmpeg à toa.
  assert.ok(inicio > 0 && iDisco > 0 && iRtsp > 0, 'ambos os caminhos precisam existir');
  assert.ok(iDisco < iRtsp, 'o disco (rápido) tem de ser tentado antes do RTSP (lento)');
});

test('a última gravação continua sendo fallback mesmo quando é antiga', () => {
  const i = SRC.indexOf('private async latestDiskThumbnail');
  const corpo = SRC.slice(i, i + 2600);
  assert.doesNotMatch(corpo, /maxAgeMs/, 'a idade não pode descartar a última cena conhecida');
  assert.match(corpo, /source: 'recording'/, 'o fallback precisa ser identificado como gravação');
  assert.match(corpo, /remainingDateLevels/, 'a busca precisa voltar ao dia anterior quando a pasta atual está vazia');
});

test('fallback dispara atualização live e fresh aguarda o mesmo trabalho', () => {
  const i = SRC.indexOf('async getLivePosterFrame');
  const corpo = SRC.slice(i, i + 1800);
  assert.match(corpo, /refreshLivePoster\(cameraId, cached\)/, 'servir a gravação precisa iniciar a captura live');
  assert.match(corpo, /if \(preferLive\) return refresh/, 'fresh precisa aguardar a atualização já iniciada');
  assert.match(SRC, /source: 'live'/, 'a captura atual deve substituir explicitamente o fallback');
});

test('integração: entrega gravação antiga na hora e depois promove para live', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drac-poster-'));
  try {
    const oldHour = join(root, 'camera-cam-1', '2026', '08', '19', '23');
    const emptyNewHour = join(root, 'camera-cam-1', '2026', '08', '20', '00');
    mkdirSync(oldHour, { recursive: true });
    mkdirSync(emptyNewHour, { recursive: true });
    writeFileSync(join(oldHour, '2026-08-19_23-59-00.thumb.jpg'), Buffer.from('ultima-gravacao'));

    const service = new FfmpegMjpegService(
      { get: (key: string) => key === 'recordingsRoot' ? root : undefined } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    let releaseLive!: () => void;
    const liveReady = new Promise<void>((resolve) => { releaseLive = resolve; });
    (service as any).generateLivePosterFrame = async () => {
      await liveReady;
      const live = { buffer: Buffer.from('frame-atual'), generatedAt: Date.now(), source: 'live' as const };
      (service as any).posterCache.set('cam-1', live);
      return live;
    };

    const fallback = await service.getLivePosterFrame('cam-1');
    assert.equal(fallback.source, 'recording');
    assert.equal(fallback.buffer.toString(), 'ultima-gravacao');

    const promotedPromise = service.getLivePosterFrame('cam-1', true);
    releaseLive();
    const promoted = await promotedPromise;
    assert.equal(promoted.source, 'live');
    assert.equal(promoted.buffer.toString(), 'frame-atual');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
