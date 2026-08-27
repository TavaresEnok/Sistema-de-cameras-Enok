'use strict';

const PLANS = Object.freeze({
  CUSTOM: { label: 'Personalizada', maxCameras: null, maxUsers: null, maxRetentionDays: null },
  ESSENTIAL: { label: 'Essencial', maxCameras: 16, maxUsers: 5, maxRetentionDays: 7 },
  PROFESSIONAL: { label: 'Profissional', maxCameras: 50, maxUsers: 20, maxRetentionDays: 30 },
  COMPLETE: { label: 'Completa', maxCameras: 200, maxUsers: 100, maxRetentionDays: 90 },
});

function normalizePlan(value) {
  const key = String(value || 'CUSTOM').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(PLANS, key) ? key : 'CUSTOM';
}

function limitsFor(item) {
  return {
    maxCameras: item.maxCameras ?? null,
    maxUsers: item.maxUsers ?? null,
    maxRetentionDays: item.maxRetentionDays ?? null,
  };
}

function usageFor(item) {
  const metrics = item?.metrics || {};
  return {
    cameras: Number(metrics.cameraTotal || 0),
    users: Number(metrics.activeUsers || 0),
    storageBytes: Number(metrics.recordingBytes || 0),
    diskUsagePercent: Number(metrics.diskUsagePercent || 0),
  };
}

module.exports = { PLANS, normalizePlan, limitsFor, usageFor };
