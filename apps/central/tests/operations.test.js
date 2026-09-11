'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const operations = require('../src/operations');

test('fila aceita somente ações declaradas e uma operação por instalação', () => {
  const item = {};
  assert.equal(operations.enqueue(item, { id: 'one', action: 'rm -rf /', requestedBy: 'admin' }).error, 'invalid_operation');
  const first = operations.enqueue(item, { id: 'one', action: 'restart_api', requestedBy: 'admin' });
  assert.equal(first.ok, true);
  assert.equal(operations.enqueue(item, { id: 'two', action: 'restart_web', requestedBy: 'admin' }).error, 'operation_already_pending');
});

test('claim entrega lease de uso único e resultado sem lease é recusado', () => {
  const item = {};
  operations.enqueue(item, { id: 'one', action: 'restart_api', requestedBy: 'admin' });
  const claimed = operations.claim(item, { leaseToken: 'lease-1', now: new Date('2026-09-09T10:00:00Z') });
  assert.equal(claimed.action, 'restart_api');
  assert.equal(operations.finish(item, 'one', { leaseToken: 'outro', status: 'SUCCEEDED' }).error, 'invalid_operation_lease');
  const finished = operations.finish(item, 'one', { leaseToken: 'lease-1', status: 'SUCCEEDED', result: 'ok' });
  assert.equal(finished.ok, true);
  assert.equal(finished.operation.status, operations.SUCCEEDED);
  assert.ok(!('leaseToken' in finished.operation));
});

test('ordem perdida não é repetida automaticamente depois do prazo', () => {
  const item = {};
  operations.enqueue(item, { id: 'one', action: 'restart_api', requestedBy: 'admin' });
  const at = new Date('2026-09-09T10:00:00Z');
  operations.claim(item, { leaseToken: 'lease', now: at });
  operations.expireTimedOut(item, new Date('2026-09-09T10:04:00Z'));
  assert.equal(item.operations[0].status, operations.TIMED_OUT);
  assert.equal(operations.claim(item, { leaseToken: 'another', now: new Date('2026-09-09T10:05:00Z') }), null);
});
