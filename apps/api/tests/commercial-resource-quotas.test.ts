import test from 'node:test';
import assert from 'node:assert/strict';
import { CommercialPolicyService } from '../src/commercial-policy/commercial-policy.service';

function serviceWith(policy: { maxUsers: number | null; maxRetentionDays: number | null }, activeUsers = 0) {
  const service = new CommercialPolicyService({ user: { count: async () => activeUsers } } as any);
  (service as any).getPolicy = async () => policy;
  return service;
}

test('cota de usuários permite até o contratado e bloqueia o excedente', async () => {
  await serviceWith({ maxUsers: 5, maxRetentionDays: null }, 4).assertUserQuota(1);
  await assert.rejects(() => serviceWith({ maxUsers: 5, maxRetentionDays: null }, 5).assertUserQuota(1), (error: any) => error?.status === 423);
});

test('cota ausente mantém retrocompatibilidade e retenção acima do contrato é recusada', async () => {
  await serviceWith({ maxUsers: null, maxRetentionDays: null }, 999).assertUserQuota(1);
  await serviceWith({ maxUsers: null, maxRetentionDays: 7 }).assertRetentionQuota(7);
  await assert.rejects(() => serviceWith({ maxUsers: null, maxRetentionDays: 7 }).assertRetentionQuota(8), (error: any) => error?.status === 423);
});
