import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudConnectorService } from '../src/cloud-connector/cloud-connector.service';

test('a instalação aplica somente a identidade simples recebida da Central', async () => {
  let patched: Record<string, unknown> | null = null;
  const service = Object.create(CloudConnectorService.prototype) as any;
  service.moduleRef = {
    get() {
      return { patch: async (values: Record<string, unknown>) => { patched = values; } };
    },
  };

  await service.applyManagedBranding({
    facilityName: 'VIBE',
    brandLogoDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    brandUseDefaultColors: false,
    brandPrimaryColor: '#b604a7',
    brandBackgroundColor: '#121016',
    brandDangerColor: '#ffffff',
    hiddenNavPaths: '/alarms',
  });

  assert.equal(patched?.facilityName, 'VIBE');
  assert.equal(patched?.brandLogoDataUrl, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(patched?.brandUseDefaultColors, false);
  assert.equal(patched?.brandPrimaryColor, '#b604a7');
  assert.equal(patched?.brandBackgroundColor, '#121016');
  assert.equal(patched?.brandLightPrimaryColor, '#b604a7');
  assert.equal(patched?.brandSecondaryColor, '', 'override avançado anterior é limpo');
  assert.equal(patched?.brandDangerColor, '', 'campo extra recebido nunca controla a paleta');
  assert.equal((patched as Record<string, unknown>).hiddenNavPaths, undefined);
});

test('payload remoto sem nome é rejeitado e não altera configurações', async () => {
  let called = false;
  const service = Object.create(CloudConnectorService.prototype) as any;
  service.moduleRef = { get: () => ({ patch: async () => { called = true; } }) };
  await assert.rejects(() => service.applyManagedBranding({ brandPrimaryColor: '#112233' }), /sem nome/);
  assert.equal(called, false);
});
