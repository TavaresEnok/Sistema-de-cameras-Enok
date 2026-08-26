import assert from 'node:assert/strict';
import test from 'node:test';
import { CamerasService } from '../src/cameras/cameras.service';

test('lista de câmeras entrega ID, retenção efetiva e ocupação local + nuvem', async () => {
  let storageQueries = 0;
  const service = Object.create(CamerasService.prototype) as any;
  service.configService = { get: () => 3 };
  service.prisma = {
    camera: {
      findMany: async () => [{
        id: 'uuid-camera-1',
        publicId: 100001,
        name: 'Portaria',
        passwordEncrypted: 'segredo-cifrado',
        retentionDays: 90,
        retentionFollowsGroup: true,
        group: { retentionDays: 3 },
      }],
    },
    recording: {
      groupBy: async (query: any) => {
        storageQueries += 1;
        return query.where.localDeletedAt === null
          ? [{ cameraId: 'uuid-camera-1', _sum: { sizeBytes: 2_000n } }]
          : [{ cameraId: 'uuid-camera-1', _sum: { sizeBytes: 3_000n } }];
      },
    },
  };

  const [camera] = await service.findAll();
  assert.equal(camera.publicId, 100001);
  assert.equal(camera.effectiveRetentionDays, 3);
  assert.equal(camera.storageLocalBytes, 2_000);
  assert.equal(camera.storageCloudBytes, 3_000);
  assert.equal(camera.storageUsedBytes, 5_000);
  assert.equal('passwordEncrypted' in camera, false);

  await service.findAll();
  assert.equal(storageQueries, 2, 'a segunda listagem deve reutilizar o cache de ocupação');
});
