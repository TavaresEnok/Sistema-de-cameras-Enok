import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(__dirname, '../../..');
const updateScript = readFileSync(resolve(repositoryRoot, 'scripts/update-drac.sh'), 'utf8');
const restoreScript = readFileSync(resolve(repositoryRoot, 'scripts/restore-drac.sh'), 'utf8');
const apiDockerfile = readFileSync(resolve(repositoryRoot, 'apps/api/Dockerfile'), 'utf8');
const apiEntrypoint = readFileSync(resolve(repositoryRoot, 'apps/api/docker-entrypoint.sh'), 'utf8');
const compose = readFileSync(resolve(repositoryRoot, 'infra/docker-compose.yml'), 'utf8');

test('API aplica migrações antes de iniciar mesmo fora do script oficial', () => {
  assert.match(apiDockerfile, /docker-entrypoint\.sh/);
  assert.match(apiEntrypoint, /prisma migrate deploy/);
  assert.ok(
    apiEntrypoint.indexOf('prisma migrate deploy') < apiEntrypoint.indexOf('exec node dist\/main\.js'),
    'migração precisa ocorrer antes do processo HTTP',
  );
  assert.match(compose, /3000\/health\/ready/);
});

test('update mantém writers quiescentes durante rollback transacional', () => {
  assert.match(updateScript, /stop api web drac-central/);
  assert.match(updateScript, /--exit-on-error --single-transaction/);
  assert.doesNotMatch(updateScript, /pg_restore[^\n]*\|\| true/);
  assert.match(updateScript, /ROLLBACK INCOMPLETO/);
});

test('update aguarda API e Web iniciarem antes de considerar o deploy quebrado', () => {
  assert.match(updateScript, /wait_for_http\(\)/);
  assert.match(updateScript, /for attempt in \$\(seq 1 "\$attempts"\)/);
  assert.match(updateScript, /wait_for_http GET http:\/\/127\.0\.0\.1:3000\/health\/ready API/);
  assert.match(updateScript, /wait_for_http HEAD http:\/\/127\.0\.0\.1:5173\/ Web/);
});

test('update bloqueia a migration histórica quando ainda existem gravações duplicadas', () => {
  assert.match(updateScript, /preflight_recording_duplicates/);
  assert.match(updateScript, /20260501042000_recordings_indexes/);
  assert.match(updateScript, /GROUP BY \\"filePath\\"/);
  assert.match(updateScript, /recusou a deleção arbitrária por ctid/);
});

test('restore valida dump e archive antes de marcar o ambiente como mutado', () => {
  const scratch = restoreScript.indexOf('validate_dump_in_scratch_database /tmp/drac-restore-input.dump');
  const archive = restoreScript.indexOf('validate_storage_archive "$STORAGE_ARCHIVE"');
  const mutated = restoreScript.indexOf('RESTORE_MUTATED=true');
  assert.ok(scratch >= 0 && scratch < mutated);
  assert.ok(archive >= 0 && archive < mutated);
  assert.match(restoreScript, /--exit-on-error --single-transaction/);
});

test('restore recusa traversal/links e preserva banco e storage para rollback', () => {
  assert.match(restoreScript, /Archive de storage contém caminho absoluto ou traversal/);
  assert.match(restoreScript, /Archive de storage contém link ou arquivo especial/);
  assert.match(restoreScript, /postgres-before\.dump/);
  assert.match(restoreScript, /storage-before/);
  assert.match(restoreScript, /ROLLBACK INCOMPLETO/);
  assert.match(restoreScript, /api web drac-central ai-service camera-worker/);
});
