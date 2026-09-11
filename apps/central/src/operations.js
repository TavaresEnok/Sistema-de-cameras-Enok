'use strict';

// ── OPERAÇÕES REMOTAS DA FROTA ─────────────────────────────────────────────
//
// A Central nunca abre Docker nem SSH da instalação para a internet. Cada
// instalação pergunta por operações pendentes usando sua identidade já
// existente (installation id + license key). Assim funciona atrás de NAT e uma
// credencial comprometida da Central não vira shell remoto arbitrário.

const ACTIONS = Object.freeze({
  update: { label: 'Atualizar para a versão aprovada', timeoutMs: 30 * 60 * 1000, disruptive: true },
  restart_web: { label: 'Reiniciar interface', timeoutMs: 3 * 60 * 1000, disruptive: false },
  restart_api: { label: 'Reiniciar API', timeoutMs: 3 * 60 * 1000, disruptive: false },
  restart_mediamtx: { label: 'Reiniciar serviço de vídeo', timeoutMs: 3 * 60 * 1000, disruptive: true },
  restart_rtmp: { label: 'Reiniciar entrada RTMP', timeoutMs: 3 * 60 * 1000, disruptive: true },
  restart_ai: { label: 'Reiniciar IA', timeoutMs: 5 * 60 * 1000, disruptive: false },
  restart_stack: { label: 'Reiniciar serviços da aplicação', timeoutMs: 8 * 60 * 1000, disruptive: true },
  restart_docker: { label: 'Reiniciar Docker do servidor', timeoutMs: 10 * 60 * 1000, disruptive: true, critical: true },
});

const PENDING = 'PENDING';
const RUNNING = 'RUNNING';
const SUCCEEDED = 'SUCCEEDED';
const FAILED = 'FAILED';
const TIMED_OUT = 'TIMED_OUT';
const MAX_HISTORY = 40;

function actionInfo(action) {
  return ACTIONS[String(action || '')] || null;
}

function normalizeAction(action) {
  const value = String(action || '').trim();
  return actionInfo(value) ? value : null;
}

function publicOperation(operation) {
  if (!operation || typeof operation !== 'object') return null;
  const info = actionInfo(operation.action);
  return {
    id: operation.id,
    action: operation.action,
    label: info?.label || operation.action,
    disruptive: Boolean(info?.disruptive),
    critical: Boolean(info?.critical),
    status: operation.status,
    requestedAt: operation.requestedAt || null,
    requestedBy: operation.requestedBy || null,
    startedAt: operation.startedAt || null,
    finishedAt: operation.finishedAt || null,
    expiresAt: operation.expiresAt || null,
    targetCommit: operation.targetCommit || null,
    result: operation.result || null,
    error: operation.error || null,
  };
}

function operationList(item) {
  return Array.isArray(item?.operations) ? item.operations : [];
}

function expireTimedOut(item, now = new Date()) {
  let changed = false;
  for (const operation of operationList(item)) {
    if (operation.status !== RUNNING || !operation.expiresAt) continue;
    if (new Date(operation.expiresAt).getTime() > now.getTime()) continue;
    operation.status = TIMED_OUT;
    operation.finishedAt = now.toISOString();
    operation.error = 'A instalação não confirmou o resultado dentro do prazo. Nenhuma repetição automática foi feita.';
    delete operation.leaseToken;
    changed = true;
  }
  return changed;
}

function enqueue(item, { id, action, requestedBy, targetCommit = null, now = new Date() }) {
  const normalized = normalizeAction(action);
  if (!normalized) return { ok: false, error: 'invalid_operation' };
  const existing = operationList(item);
  if (existing.some((operation) => operation.status === PENDING || operation.status === RUNNING)) {
    return { ok: false, error: 'operation_already_pending' };
  }
  const operation = {
    id,
    action: normalized,
    targetCommit: targetCommit || null,
    status: PENDING,
    requestedAt: now.toISOString(),
    requestedBy: String(requestedBy || '').slice(0, 240) || null,
    startedAt: null,
    finishedAt: null,
    expiresAt: null,
    result: null,
    error: null,
  };
  item.operations = [...existing, operation].slice(-MAX_HISTORY);
  return { ok: true, operation };
}

function claim(item, { leaseToken, now = new Date() }) {
  expireTimedOut(item, now);
  const operation = operationList(item).find((entry) => entry.status === PENDING);
  if (!operation) return null;
  const info = actionInfo(operation.action);
  operation.status = RUNNING;
  operation.startedAt = now.toISOString();
  operation.expiresAt = new Date(now.getTime() + (info?.timeoutMs || 5 * 60 * 1000)).toISOString();
  operation.leaseToken = leaseToken;
  return { ...operation };
}

function finish(item, operationId, { leaseToken, status, result, error, now = new Date() }) {
  const operation = operationList(item).find((entry) => entry.id === operationId);
  if (!operation) return { ok: false, error: 'operation_not_found' };
  if (operation.status !== RUNNING) return { ok: false, error: 'operation_not_running' };
  if (String(operation.leaseToken || '') !== String(leaseToken || '')) return { ok: false, error: 'invalid_operation_lease' };
  if (![SUCCEEDED, FAILED].includes(status)) return { ok: false, error: 'invalid_operation_result' };
  operation.status = status;
  operation.finishedAt = now.toISOString();
  operation.result = String(result || '').slice(0, 4_000) || null;
  operation.error = String(error || '').slice(0, 1_000) || null;
  delete operation.leaseToken;
  return { ok: true, operation };
}

module.exports = {
  ACTIONS,
  PENDING,
  RUNNING,
  SUCCEEDED,
  FAILED,
  TIMED_OUT,
  actionInfo,
  normalizeAction,
  publicOperation,
  operationList,
  expireTimedOut,
  enqueue,
  claim,
  finish,
};
