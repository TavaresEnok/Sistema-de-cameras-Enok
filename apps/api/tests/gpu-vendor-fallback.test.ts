import test from 'node:test';
import assert from 'node:assert/strict';
import { GpuService, parseNvidiaProcModel, parseNvidiaProcDriver } from '../src/gpu/gpu.service';
import { __resetHwaccelDetectionCache, type FfmpegExec } from '../src/camera-stream/helpers/hwaccel-presets.helper';

// ── O vendedor mentiroso ────────────────────────────────────────────────────
// A detecção da placa rodava `nvidia-smi` DENTRO do container da API — onde o
// binário não existe (só a imagem nvenc do MediaMTX o carrega). Falhou o exec,
// `device` virou null e o código caiu no ramo da iGPU: a tela de Aceleração do
// D-GUARDIAN anunciava "vendor: intel" numa máquina com RTX 5060 Ti transcodando
// (medido em 13/08/2026). O admin decide em cima do que essa tela mostra.
//
// A correção lê o que o KERNEL expõe (/proc/driver/nvidia), visível de dentro
// de qualquer container que receba o device node. Os fixtures abaixo são o
// conteúdo REAL devolvido pelo D-GUARDIAN, não amostras inventadas.

const PROC_INFORMATION = [
  'Model: \t\t NVIDIA GeForce RTX 5060 Ti',
  'IRQ:   \t\t 11',
  'GPU UUID: \t GPU-94a3571f-16c4-275a-dade-83039ef50dea',
  'Video BIOS: \t 98.06.4e.00.8f',
  'Bus Type: \t PCIe',
].join('\n');

const PROC_VERSION =
  'NVRM version: NVIDIA UNIX Open Kernel Module for x86_64  610.43.02  Release Build  (dvs-builder@U22-I3-H05-01-2)  Tue May 19 11:24:27 UTC 2026';

test('parse do /proc: modelo e driver saem do formato real do kernel', () => {
  assert.equal(parseNvidiaProcModel(PROC_INFORMATION), 'NVIDIA GeForce RTX 5060 Ti');
  assert.equal(parseNvidiaProcDriver(PROC_VERSION), '610.43.02');
});

test('parse do /proc: conteúdo estranho devolve null, nunca lixo', () => {
  assert.equal(parseNvidiaProcModel('nada a ver'), null);
  assert.equal(parseNvidiaProcModel(''), null);
  assert.equal(parseNvidiaProcDriver('sem numero de versao aqui'), null);
  assert.equal(parseNvidiaProcDriver(''), null);
});

// getStatus de verdade, com o exec falhando como no container da API.

const ENCODERS = ' V....D h264_nvenc  NVIDIA NVENC H.264 encoder (codec h264)';

function makeService(options: { viaProc: boolean }) {
  __resetHwaccelDetectionCache();
  const ffmpeg: FfmpegExec = async (args) => {
    if (args.includes('-encoders')) return { ok: true, stdout: ENCODERS, stderr: '' };
    return { ok: false, stdout: '', stderr: 'Cannot load libcuda.so.1' };
  };
  const svc: any = Object.create(GpuService.prototype);
  svc.logger = { log: () => {}, warn: () => {}, error: () => {} };
  svc.config = { get: (key: string) => (key === 'gpuTranscodeAvailable' ? 'true' : undefined) };
  svc.settings = {
    isGpuAccelerationEnabled: async () => false,
    isAiFeatureEnabled: async () => false,
    isGpuAiAccelerationEnabled: async () => false,
  };
  // O cenário exato do container da API: nvidia-smi NÃO EXISTE.
  svc.exec = async (cmd: string, args: string[]) => {
    if (cmd === 'nvidia-smi') return { ok: false, stdout: '', stderr: 'command not found' };
    return ffmpeg(args);
  };
  svc.detectNvidiaViaProc = async () =>
    options.viaProc
      ? { name: 'NVIDIA GeForce RTX 5060 Ti', driver: '610.43.02', memoryTotalMb: null }
      : null;
  svc.probeAiRuntime = async () => ({ reachable: false, runtime: null, device: null });
  svc.hwaccelProbeOptions = () => ({
    exec: ffmpeg,
    listRenderNodes: async () => ['/dev/dri/renderD128'],
    probeFile: '/tmp/drac-teste-probe.mp4',
    mode: 'auto' as const,
  });
  return svc as GpuService;
}

test('sem nvidia-smi mas com a placa no kernel: vendor é nvidia, não intel', async () => {
  const status = await makeService({ viaProc: true }).getStatus();
  assert.equal(status.vendor, 'nvidia', 'o defeito original: anunciava a iGPU com a RTX presente');
  assert.equal(status.device?.name, 'NVIDIA GeForce RTX 5060 Ti');
  assert.equal(status.device?.driver, '610.43.02');
});

test('sem nvidia-smi E sem device node: cai na iGPU como antes (nada regride)', async () => {
  const status = await makeService({ viaProc: false }).getStatus();
  assert.notEqual(status.vendor, 'nvidia', 'sem placa nenhuma não pode inventar nvidia');
  assert.equal(status.device, null);
});
