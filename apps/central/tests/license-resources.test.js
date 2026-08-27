'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PLANS, normalizePlan, limitsFor, usageFor } = require('../src/license-resources');

test('planos comerciais têm limites explícitos sem inventar preço', () => {
  assert.equal(PLANS.PROFESSIONAL.maxCameras, 50);
  assert.equal(normalizePlan('professional'), 'PROFESSIONAL');
  assert.equal(normalizePlan('desconhecido'), 'CUSTOM');
});
test('consumo usa somente métricas reais do heartbeat', () => {
  assert.deepEqual(usageFor({ metrics: { cameraTotal: 9, activeUsers: 3, recordingBytes: 12 } }), { cameras: 9, users: 3, storageBytes: 12, diskUsagePercent: 0 });
  assert.deepEqual(limitsFor({ maxCameras: 10 }), { maxCameras: 10, maxUsers: null, maxRetentionDays: null });
});
