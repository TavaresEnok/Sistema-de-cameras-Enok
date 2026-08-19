'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { ADMIN_TOKEN, startCentral } = require('./helpers/central-server');

const admin = () => ({ authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' });

async function provision(central, id) {
  const response = await fetch(`${central.base}/api/admin/provision`, {
    method: 'POST',
    headers: admin(),
    body: JSON.stringify({ customerName: 'Cliente Marca', installationId: id }),
  });
  assert.equal(response.status, 201, await response.text());
  const db = JSON.parse(await fsp.readFile(path.join(central.dir, 'installations.json'), 'utf8'));
  return db.installations[id].licenseKey;
}

async function heartbeat(central, id, licenseKey, configState = undefined) {
  const response = await fetch(`${central.base}/api/agent/heartbeat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-drac-installation-id': id,
      'x-drac-license-key': licenseKey,
    },
    body: JSON.stringify({ summary: {}, ...(configState ? { configState } : {}) }),
  });
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return JSON.parse(body);
}

test('a Central salva a marca simples e a entrega no heartbeat autenticado', async (t) => {
  const central = await startCentral();
  t.after(() => central.stop());
  const id = 'cliente-marca';
  const licenseKey = await provision(central, id);
  const branding = {
    facilityName: 'VIBE',
    brandLogoDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    brandUseDefaultColors: false,
    brandPrimaryColor: '#B604A7',
    brandBackgroundColor: '#121016',
  };

  const saved = await fetch(`${central.base}/api/admin/installations/${id}/app`, {
    method: 'PATCH', headers: admin(),
    body: JSON.stringify({ appName: 'VIBE', branding }),
  });
  const result = await saved.json();
  assert.equal(saved.status, 200, JSON.stringify(result));
  assert.equal(result.branding.brandPrimaryColor, '#b604a7');
  assert.equal(result.brandingChanged, true);
  assert.ok(result.configRevision > 0);

  const command = await heartbeat(central, id, licenseKey);
  assert.deepEqual(command.branding, {
    ...branding,
    brandPrimaryColor: '#b604a7',
  });
  assert.equal(command.configRevision, result.configRevision);

  await heartbeat(central, id, licenseKey, {
    appliedRevision: result.configRevision,
    applyStatus: 'APPLIED',
    supports: ['branding'],
  });
  const db = JSON.parse(await fsp.readFile(path.join(central.dir, 'installations.json'), 'utf8'));
  assert.equal(db.installations[id].appliedConfigRevision, result.configRevision);
  assert.ok(db.auditEvents.some((event) => event.type === 'installation.branding_changed'));
});

test('a Central recusa SVG e cor inválida antes de criar uma revisão', async (t) => {
  const central = await startCentral();
  t.after(() => central.stop());
  const id = 'marca-invalida';
  await provision(central, id);
  const response = await fetch(`${central.base}/api/admin/installations/${id}/app`, {
    method: 'PATCH', headers: admin(),
    body: JSON.stringify({ branding: {
      facilityName: 'Teste',
      brandLogoDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      brandUseDefaultColors: false,
      brandPrimaryColor: 'vermelho',
      brandBackgroundColor: '',
    } }),
  });
  assert.equal(response.status, 400);
  const db = JSON.parse(await fsp.readFile(path.join(central.dir, 'installations.json'), 'utf8'));
  assert.equal(db.installations[id].configRevision || 0, 0);
});

test('o painel oferece editor curto com logo, destaque, fundo opcional e prévia', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  for (const id of [
    'app-brand-preview', 'app-edit-logo-file', 'app-edit-primary',
    'app-edit-custom-background', 'app-edit-brand-default',
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /Identidade visual/);
  assert.match(html, /A instalação aplicará automaticamente/);
});
