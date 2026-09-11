'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startCentral } = require('./helpers/central-server');

test('Central enfileira operação confirmada e só a instalação autenticada pode buscá-la', async (t) => {
  const central = await startCentral();
  t.after(() => central.stop());
  const provision = await fetch(`${central.base}/api/admin/provision`, {
    method: 'POST', headers: central.adminHeaders(),
    body: JSON.stringify({ installationId: 'cliente-ops', customerName: 'Cliente Ops' }),
  });
  assert.equal(provision.status, 201);
  const created = await provision.json();
  const licenseKey = created.licenseKey;

  const denied = await fetch(`${central.base}/api/admin/installations/cliente-ops/operations`, {
    method: 'POST', headers: central.adminHeaders(),
    body: JSON.stringify({ action: 'restart_api', confirmation: 'errado' }),
  });
  assert.equal(denied.status, 400, 'servidor exige confirmação, não só a tela');

  const queued = await fetch(`${central.base}/api/admin/installations/cliente-ops/operations`, {
    method: 'POST', headers: central.adminHeaders(),
    body: JSON.stringify({ action: 'restart_api', confirmation: 'restart_api' }),
  });
  assert.equal(queued.status, 202);

  const agentHeaders = {
    'x-drac-installation-id': 'cliente-ops',
    'x-drac-license-key': licenseKey,
  };
  const claim = await fetch(`${central.base}/api/agent/operations/claim`, { method: 'POST', headers: agentHeaders });
  assert.equal(claim.status, 200);
  const claimed = await claim.json();
  assert.equal(claimed.operation.action, 'restart_api');

  const finished = await fetch(`${central.base}/api/agent/operations/${claimed.operation.id}/result`, {
    method: 'POST', headers: { ...agentHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ leaseToken: claimed.operation.leaseToken, status: 'SUCCEEDED', result: 'API saudável.' }),
  });
  assert.equal(finished.status, 200);

  const listing = await fetch(`${central.base}/api/admin/installations`, { headers: central.adminHeaders() });
  const items = (await listing.json()).items;
  assert.equal(items[0].operations[0].status, 'SUCCEEDED');
});
