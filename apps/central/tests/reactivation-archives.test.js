'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ReactivationArchiveStore, expiresAfterMonths, sanitizeSnapshot } = require('../src/reactivation-archives');

test('arquivo final é AES-GCM, não contém dados em claro e pode ser restaurado', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'drac-reactivation-'));
  const store = new ReactivationArchiveStore({ directory: dir, secret: 'uma-chave-separada-com-mais-de-32-caracteres' });
  const snapshot = { version: 1, cameras: [{ id: 'cam-1', name: 'Portão', ip: '192.168.1.2' }], users: [] };
  const meta = await store.write('cliente-a', 'req-1', snapshot, '2028-08-18T00:00:00.000Z');
  const raw = await fs.readFile(path.join(dir, 'cliente-a.archive'), 'utf8');
  assert.equal(raw.includes('Portão'), false);
  assert.equal(meta.state, 'AVAILABLE');
  assert.equal(meta.sha256.length, 64);
  assert.deepEqual((await store.read('cliente-a')).snapshot, sanitizeSnapshot(snapshot));
  await store.delete('cliente-a');
  await assert.rejects(() => fs.stat(path.join(dir, 'cliente-a.archive')));
});

test('snapshot recusa senhas, sessões e segredos mesmo em campos aninhados', () => {
  assert.throws(() => sanitizeSnapshot({ cameras: [{ passwordEncrypted: 'abc' }] }), /credencial/);
  assert.throws(() => sanitizeSnapshot({ systemSettings: [{ tokenHash: 'abc' }] }), /credencial/);
});

test('validade padrão pode ser calculada em 24 meses', () => {
  assert.equal(expiresAfterMonths(new Date('2026-08-18T00:00:00Z'), 24), '2028-08-18T00:00:00.000Z');
});
