import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RtmpDiscoveryService } from '../src/cameras/rtmp-discovery.service';
import { PendingIngestRegistry } from '../src/cameras/pending-ingest.registry';

const path = 'live/equipment_test';
function setup(rows = new Map<string, any>()) {
  const pending = new PendingIngestRegistry(); pending.record(path, '192.0.2.5');
  let owned = false, bound = false;
  const prisma: any = {
    camera: { findFirst: async () => owned ? { id: 'existing-even-disabled' } : null },
    systemSetting: {
      findUnique: async ({ where }: any) => rows.get(where.key) || null,
      findMany: async ({ where }: any) => [...rows].filter(([key]) => key.startsWith(where.key.startsWith)).map(([, row]) => row),
      count: async () => [...rows.keys()].filter(key => key.includes('.ignore.')).length,
      create: async ({ data }: any) => { if (rows.has(data.key)) throw new Error('duplicate'); rows.set(data.key, data); },
      upsert: async ({ create }: any) => rows.set(create.key, create),
      deleteMany: async ({ where }: any) => rows.delete(where.key),
    },
  };
  const service = new RtmpDiscoveryService(prisma, { get: () => undefined } as any, pending,
    { findCameraByIngestPath: async () => bound ? { id: 'registered' } : null } as any);
  const calls: string[] = [];
  (service as any).srs = async (route: string, method = 'GET') => {
    calls.push(`${method} ${route}`);
    return { code: 0, clients: [
      { id: 'preview', url: '__defaultVhost__/' + path },
      { id: 'unrelated', url: 'another/' + path },
    ] };
  };
  return { service, rows, pending, calls, own: () => { owned = true; }, bind: () => { bound = true; owned = true; } };
}
test('only the selected pending path and source may publish during the lease', async () => {
  const { service } = setup();
  const lease = await service.start(path, 'admin');
  assert.ok(lease.expiresAt > Date.now());
  assert.equal(service.allows(path, '192.0.2.5'), true);
  assert.equal(service.allows(path, '192.0.2.6'), false);
  assert.equal(service.allows('live/other'), false);
  await service.stop('admin', lease.id);
  assert.equal(service.allows(path), false);
});
test('unknown or owned (including disabled/private) camera cannot be previewed', async () => {
  const fixture = setup();
  await assert.rejects(fixture.service.start('live/unknown', 'admin'));
  fixture.own();
  assert.deepEqual((await fixture.service.list()).items, []);
  await assert.rejects(fixture.service.start(path, 'admin'));
});
test('one preview at a time and stale/foreign stop cannot cancel it', async () => {
  const { service } = setup(); const lease = await service.start(path, 'admin');
  await assert.rejects(service.start(path, 'admin'));
  await service.stop('other-admin', lease.id);
  await service.stop('admin', 'old-session');
  assert.equal(service.allows(path), true);
  await assert.rejects(service.frame('other-admin', lease.id));
  await service.stop('admin', lease.id);
});
test('stop disconnects only the exact preview publisher, not suffix matches', async () => {
  const { service, calls, rows } = setup(); const lease = await service.start(path, 'admin');
  await service.stop('admin', lease.id);
  assert.ok(calls.includes('DELETE clients/preview'));
  assert.ok(!calls.includes('DELETE clients/unrelated'));
  assert.equal(rows.has('rtmp.discovery.preview'), false);
});
test('adding the camera keeps its publisher connected when the preview ends', async () => {
  const { service, calls, bind } = setup(); const lease = await service.start(path, 'admin');
  bind(); await service.stop('admin', lease.id);
  assert.ok(!calls.some(call => call.startsWith('DELETE')));
});
test('ignored list survives service restart and can be restored', async () => {
  const first = setup(); await first.service.ignore(path, 'admin');
  const second = setup(first.rows);
  assert.equal((await second.service.list()).items.length, 0);
  assert.equal((await second.service.list()).ignored.length, 1);
  await assert.rejects(second.service.start(path, 'admin'));
  await second.service.ignore(path, 'admin', true);
  assert.equal((await second.service.list()).items.length, 1);
});
test('restart revokes and cleans persisted preview before accepting a new one', async () => {
  const first = setup(); await first.service.start(path, 'admin');
  const second = setup(first.rows); await second.service.onModuleInit();
  try {
    assert.equal(second.service.allows(path), false);
    const lease = await second.service.start(path, 'admin');
    assert.ok(second.calls.includes('DELETE clients/preview'));
    await second.service.stop('admin', lease.id);
  } finally { second.service.onModuleDestroy(); }
});
test('unavailable cleanup channel fails closed before opening a preview', async () => {
  const { service } = setup(); (service as any).srs = async () => { throw new Error('unreachable'); };
  await assert.rejects(service.start(path, 'admin'));
  assert.equal(service.allows(path), false);
});
test('cleanup failure revokes authorization and blocks new sessions until retried', async () => {
  const { service } = setup(); const lease = await service.start(path, 'admin');
  const original = (service as any).srs;
  (service as any).srs = async () => { throw new Error('unreachable'); };
  await assert.rejects(service.stop('admin', lease.id));
  assert.equal(service.allows(path), false);
  await assert.rejects(service.start(path, 'admin'));
  (service as any).srs = original;
  const next = await service.start(path, 'admin');
  await service.stop('admin', next.id);
});
