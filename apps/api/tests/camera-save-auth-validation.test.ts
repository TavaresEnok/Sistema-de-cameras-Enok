import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { CamerasService } from '../src/cameras/cameras.service';

function serviceWithProbe(result: { ok: boolean; authDenied: boolean; path?: string | null }) {
  const service = Object.create(CamerasService.prototype) as any;
  service.portChecker = { check: async () => true };
  service.probeRtspPaths = async () => result;
  return service;
}

test('senha recusada devolve uma mensagem clara e impede a criação no banco', async () => {
  const service = serviceWithProbe({ ok: false, authDenied: true });
  let writes = 0;
  service.assertTestTargetAllowed = (ip: string) => ip;
  service.validateReferences = async () => {};
  service.prisma = { camera: { create: async () => { writes += 1; } } };
  await assert.rejects(
    service.create({
      name: 'Teste', ip: '192.168.10.20', rtspPort: 554, httpPort: 80,
      username: 'admin', password: 'senha-errada', rtspPath: '/stream1',
    }),
    (error: unknown) => error instanceof BadRequestException && /recusou o usuário ou a senha/.test(error.message),
  );
  assert.equal(writes, 0);
});

test('troca de senha recusada não sobrescreve a câmera existente', async () => {
  const service = serviceWithProbe({ ok: false, authDenied: true });
  let writes = 0;
  service.getCameraOrThrow = async () => ({
    id: 'camera-1', ip: '192.168.10.20', rtspPort: 554, httpPort: 80,
    username: 'admin', rtspPath: '/stream1', passwordEncrypted: 'encrypted',
    sourceMode: 'rtsp_pull', liveChannel: 1, liveSubtype: 0,
  });
  service.assertTestTargetAllowed = (ip: string) => ip;
  service.validateReferences = async () => {};
  service.prisma = { camera: { update: async () => { writes += 1; } } };
  await assert.rejects(
    service.update('camera-1', { password: 'senha-errada' }),
    (error: unknown) => error instanceof BadRequestException && /recusou o usuário ou a senha/.test(error.message),
  );
  assert.equal(writes, 0);
});

test('porta inacessível não é apresentada como senha errada', async () => {
  const service = serviceWithProbe({ ok: false, authDenied: false });
  service.portChecker = { check: async () => false };
  await assert.rejects(
    service.verifyRtspBeforeSave({
      ip: '192.168.10.20', rtspPort: 554,
      username: 'admin', password: 'qualquer', rtspPath: '/stream1',
    }),
    (error: unknown) => error instanceof BadRequestException
      && /porta RTSP 554 não respondeu/.test(error.message)
      && !/senha/.test(error.message),
  );
});
