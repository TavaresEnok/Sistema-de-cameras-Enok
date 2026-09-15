'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { freePort, startCentral } = require('./helpers/central-server');

async function startServer(handler) {
  const port = await freePort();
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${port}`,
    async stop() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test('build-agent blackhole tem deadline e não bloqueia o health da Central', async (t) => {
  const blackhole = await startServer(() => {
    // Deliberadamente não envia headers nem resposta.
  });
  const central = await startCentral({
    APP_BUILDER_AGENT_URL: blackhole.url,
    APP_BUILDER_AGENT_TIMEOUT_MS: '1000',
  });
  t.after(async () => {
    await central.stop();
    await blackhole.stop();
  });

  const pending = fetch(`${central.base}/api/admin/apk/clients`, {
    headers: central.adminHeaders(),
  });
  await new Promise((resolve) => setTimeout(resolve, 100));

  const healthStarted = Date.now();
  const health = await fetch(`${central.base}/api/health`);
  assert.equal(health.status, 200);
  assert.ok(Date.now() - healthStarted < 500, 'health não deve entrar na fila do datastore');

  const response = await pending;
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error, 'internal_error');
});

test('resposta excessiva do build-agent é interrompida com erro seguro', async (t) => {
  const oversized = await startServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': String(128 * 1024),
    });
    res.end('{}');
  });
  const central = await startCentral({
    APP_BUILDER_AGENT_URL: oversized.url,
    APP_BUILDER_AGENT_MAX_RESPONSE_BYTES: String(64 * 1024),
  });
  t.after(async () => {
    await central.stop();
    await oversized.stop();
  });

  const response = await fetch(`${central.base}/api/admin/apk/clients`, {
    headers: central.adminHeaders(),
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, 'internal_error');
  assert.doesNotMatch(body.message || '', /128|body|token/i);
});

test('regerar APK envia ao agente exatamente a release aprovada', async (t) => {
  let received = null;
  const agent = await startServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    res.writeHead(202, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jobId: 'build-test', status: 'queued' }));
  });
  const central = await startCentral({ APP_BUILDER_AGENT_URL: agent.url });
  t.after(async () => {
    await central.stop();
    await agent.stop();
  });

  const commit = 'b'.repeat(40);
  const promoted = await fetch(`${central.base}/api/admin/releases`, {
    method: 'POST',
    headers: central.adminHeaders(),
    body: JSON.stringify({
      commit,
      installerSha256: 'a'.repeat(64),
      gate: { instalacaoLimpa: true, verificadaNaMatriz: true, em: new Date().toISOString() },
    }),
  });
  assert.equal(promoted.status, 200);

  const build = await fetch(`${central.base}/api/admin/apk/clients/vibe/build`, {
    method: 'POST',
    headers: central.adminHeaders(),
  });
  assert.equal(build.status, 202);
  assert.deepEqual(received, { slug: 'vibe', sourceCommit: commit });
});
