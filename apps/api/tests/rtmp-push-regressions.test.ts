import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { CamerasService } from '../src/cameras/cameras.service';
import { ClipCaptureService } from '../src/camera-stream/clip-capture.service';
import { FfmpegMjpegService } from '../src/camera-stream/ffmpeg-mjpeg.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { generateIngestKey } from '../src/cameras/helpers/rtmp-ingest.helper';
import type { AuthUser } from '../src/common/types/auth-user.type';
import { UserRole } from '@prisma/client';

test('botão Gravar usa a publicação interna da RTMP e nunca tenta 0.0.0.0', async () => {
  let decryptCalls = 0;
  const resolveCalls: any[] = [];
  const service = new ClipCaptureService(
    { get: () => undefined } as any,
    {} as any,
    { decrypt: () => { decryptCalls += 1; throw new Error('não deveria descriptografar RTMP'); } } as any,
    {
      resolve: async (camera: any, options: any) => {
        resolveCalls.push({ camera, options });
        return {
          sourceUrl: 'rtsp://internal-user:internal-pass@mediamtx:8554/d/abcdefghijklmnopqrstuv',
        };
      },
    } as any,
  );

  const input = await (service as any).resolveClipInput({
    id: 'push-clip-1',
    sourceMode: 'rtmp_push',
    ip: '0.0.0.0',
    passwordEncrypted: 'marcador-cifrado',
  });

  assert.equal(decryptCalls, 0);
  assert.equal(resolveCalls.length, 1);
  assert.deepEqual(resolveCalls[0].options, { requireReady: true });
  assert.equal(input.transport, 'tcp');
  assert.equal(input.url.includes('0.0.0.0'), false);
  assert.match(input.url, /^rtsp:\/\/.*@mediamtx:8554\//);
});

test('RTMP privada criada pelo app ignora continuous e herda 3 dias do grupo', async () => {
  const writes: any[] = [];
  const owner: AuthUser = {
    id: 'cliente-1',
    email: 'cliente@example.test',
    name: 'Cliente',
    role: UserRole.VIEWER,
  };
  const service = Object.create(CamerasService.prototype) as any;
  service.vinculosDeGrupo = async () => [{
    groupId: 'grupo-3-dias',
    level: 'CONTROL',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  }];
  service.getPrivateCameraQuota = async () => ({ used: 0, limit: 2 });
  service.prisma = {
    cameraGroup: {
      findUnique: async () => ({ retentionDays: 3 }),
    },
    cameraPermission: {
      create: async () => ({ id: 'permissao-1' }),
    },
  };
  service.create = async (dto: any, privacy: any) => {
    writes.push({ dto, privacy });
    return { id: 'camera-1', ...dto };
  };

  await service.createPrivateForOwner({
    name: 'Câmera do cliente',
    sourceMode: 'rtmp_push',
    recordingMode: 'continuous',
    recordingEnabled: true,
    retentionDays: 99,
    retentionFollowsGroup: false,
    motionTrigger: 'CAMERA',
    aiEnabled: false,
  }, owner);

  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].privacy, { isPrivate: true, ownerUserId: owner.id });
  assert.equal(writes[0].dto.groupId, 'grupo-3-dias');
  assert.equal(writes[0].dto.recordingMode, 'motion');
  assert.equal(writes[0].dto.recordingEnabled, false);
  assert.equal(writes[0].dto.motionTrigger, 'SYSTEM');
  assert.equal(writes[0].dto.aiEnabled, true);
  assert.equal(writes[0].dto.retentionDays, 3);
  assert.equal(writes[0].dto.retentionFollowsGroup, true);
});

test('RTMP privada sem grupo recebe retenção própria padrão de 3 dias', async () => {
  let written: any = null;
  const owner: AuthUser = {
    id: 'cliente-sem-grupo',
    email: 'sem-grupo@example.test',
    name: 'Cliente sem grupo',
    role: UserRole.VIEWER,
  };
  const service = Object.create(CamerasService.prototype) as any;
  service.vinculosDeGrupo = async () => [];
  service.getPrivateCameraQuota = async () => ({ used: 0, limit: 1 });
  service.prisma = {
    cameraGroup: { findUnique: async () => { throw new Error('não deve consultar sem grupo'); } },
    cameraPermission: { create: async () => ({}) },
  };
  service.create = async (dto: any) => {
    written = dto;
    return { id: 'camera-sem-grupo', ...dto };
  };

  await service.createPrivateForOwner({
    name: 'Câmera sem grupo',
    sourceMode: 'rtmp_push',
    recordingMode: 'continuous',
    retentionDays: 365,
  }, owner);

  assert.equal(written.recordingMode, 'motion');
  assert.equal(written.recordingEnabled, false);
  assert.equal(written.retentionDays, 3);
  assert.equal(written.retentionFollowsGroup, false);
});

test('poster de câmera RTMP offline não tenta RTSP direto nem descriptografa marcador', async () => {
  let decryptCalls = 0;
  const service = new FfmpegMjpegService(
    { get: () => undefined } as any,
    { getCameraOrThrow: async () => ({ id: 'push-1', sourceMode: 'rtmp_push' }) } as any,
    { decrypt: () => { decryptCalls += 1; throw new Error('não deveria descriptografar'); } } as any,
    { resolveGridPosterSource: async () => { throw new Error('ainda sem publicação'); } } as any,
  );
  (service as any).checkFfmpegAvailable = () => true;
  (service as any).logger = { debug() {} };

  await assert.rejects(
    () => (service as any).generateLivePosterFrame('push-1'),
    (error: unknown) => error instanceof ServiceUnavailableException
      && error.message === 'Câmera RTMP ainda não está publicando vídeo.',
  );
  assert.equal(decryptCalls, 0);
});

test('edição de câmera RTMP ignora o marcador de rede sem afrouxar câmera RTSP', async () => {
  const existing = {
    id: 'push-1',
    name: 'Portaria',
    ip: '0.0.0.0',
    rtspPort: 554,
    onvifPort: null,
    sourceMode: 'rtmp_push',
    passwordEncrypted: 'encrypted-empty',
    enabled: true,
    recordingEnabled: false,
    recordingMode: 'manual',
    alarmsEnabled: true,
    hasEdgeAi: false,
    motionTrigger: 'SYSTEM',
  };
  const writes: any[] = [];
  let networkPolicyCalls = 0;
  const service = Object.create(CamerasService.prototype) as any;
  service.getCameraOrThrow = async () => existing;
  service.assertTestTargetAllowed = () => { networkPolicyCalls += 1; throw new Error('marcador não é destino'); };
  service.validateReferences = async () => undefined;
  service.normalizeProfileToDetected = () => ({
    streamWidth: undefined,
    streamHeight: undefined,
    streamFps: undefined,
    streamBitrateKbps: undefined,
    recordingWidth: undefined,
    recordingHeight: undefined,
    recordingFps: undefined,
    recordingBitrateKbps: undefined,
  });
  service.normalizeLiveProtocol = () => 'webrtc';
  service.cryptoService = { encrypt: () => 'encrypted' };
  service.prisma = {
    camera: {
      update: async (input: any) => {
        writes.push(input);
        return { ...existing, ...input.data, ip: existing.ip };
      },
    },
  };

  await service.update('push-1', {
    name: 'Portaria atualizada',
    ip: '0.0.0.0',
    rtspPort: 554,
    username: '',
    rtspPath: '',
    recordingMode: 'manual',
    retentionDays: 7,
    preferredRtspTransport: 'tcp',
    preferredLiveProtocol: 'webrtc',
    streamVideoCodec: 'h264',
    recordingVideoCodec: 'h264',
    audioEnabled: false,
    aiEnabled: false,
    alarmsEnabled: true,
    enabled: true,
  });

  assert.equal(networkPolicyCalls, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.ip, undefined);
  assert.equal(writes[0].data.name, 'Portaria atualizada');

  service.getCameraOrThrow = async () => ({ ...existing, sourceMode: 'rtsp_pull', ip: '192.168.1.20' });
  service.assertTestTargetAllowed = (ip: string) => {
    networkPolicyCalls += 1;
    return ip;
  };
  await service.update('pull-1', { name: 'RTSP validada' });
  assert.equal(networkPolicyCalls, 1, 'câmera RTSP deve continuar passando pela política de rede');
});

test('caminho por serial não esconde a URL personalizada compatível', async () => {
  const key = generateIngestKey();
  const service = Object.create(CamerasService.prototype) as any;
  service.prisma = {
    camera: {
      findUnique: async () => ({
        sourceMode: 'rtmp_push',
        rtmpIngestKeyEncrypted: 'chave-cifrada',
        rtmpIngestPath: 'live/liveStream_H3ZL2802830WB_0_0',
      }),
    },
  };
  service.cryptoService = { decrypt: () => key };
  service.configService = {
    get: (name: string) => name === 'mediaMtxPublicHost'
      ? 'ajustcam.example.test'
      : name === 'mediaMtxRtmpShortHost'
        ? '192.0.2.25'
        : undefined,
  };

  const target = await service.getRtmpIngestTarget('camera-1');

  assert.equal(target.ingestPath, 'live/liveStream_H3ZL2802830WB_0_0');
  assert.match(target.fullUrl, /^rtmp:\/\/192\.0\.2\.25:1935\/d\/[A-Za-z0-9_-]{22}$/);
  assert.equal(target.serverUrl, 'rtmp://192.0.2.25:1935/drac');
});

test('filtro HTTP redige token tanto no log quanto na resposta de erro', () => {
  const secret = 'valor-que-nao-pode-aparecer';
  const logs: string[] = [];
  let body: any = null;
  const response = {
    status() { return response; },
    json(value: unknown) { body = value; return response; },
  };
  const filter = new HttpExceptionFilter();
  (filter as any).logger = {
    error: (message: string) => logs.push(message),
    warn: (message: string) => logs.push(message),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({
        method: 'GET',
        url: `/camera-stream/cam/poster?token=${secret}&v=1`,
        headers: {},
      }),
    }),
  };

  filter.catch(new ServiceUnavailableException('offline'), host as any);

  assert.equal(String(body?.path).includes(secret), false);
  assert.equal(logs.join('\n').includes(secret), false);
  assert.match(String(body?.path), /token=<redacted>/);
});
