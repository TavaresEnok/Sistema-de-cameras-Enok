import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('marca volta sozinha depois de indisponibilidade temporária da API', () => {
  const source = readFileSync('src/store/brandingStore.ts', 'utf8');

  assert.match(source, /brandingRetryTimer/);
  assert.match(source, /window\.setTimeout/);
  assert.match(source, /void get\(\)\.load\(\)/);
  assert.match(source, /BRANDING_RETRY_MAX_MS/);
});
