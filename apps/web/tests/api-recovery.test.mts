import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const authPath = fileURLToPath(new URL('../src/store/authStore.ts', import.meta.url));
const dataPath = fileURLToPath(new URL('../src/store/vmsDataStore.ts', import.meta.url));
const appPath = fileURLToPath(new URL('../src/App.tsx', import.meta.url));
const playerPath = fileURLToPath(new URL('../src/components/LiveStreamPlayer.tsx', import.meta.url));

test('sessão se recupera de indisponibilidade transitória sem apagar o cookie', async () => {
  const source = await readFile(authPath, 'utf8');
  assert.match(source, /SESSION_RETRY_DELAYS_MS/);
  assert.match(source, /scheduleSessionRetry\(\)/);
  assert.match(source, /timeout: 15_000/);
  assert.match(source, /state\.isAuthenticated \? state\.revalidate\(\) : state\.bootstrap\(\)/);
});

test('falha operacional agenda recarga completa com timeout e backoff', async () => {
  const source = await readFile(dataPath, 'utf8');
  assert.match(source, /API_REQUEST_TIMEOUT_MS = 15_000/);
  assert.match(source, /FULL_LOAD_RETRY_DELAYS_MS/);
  assert.match(source, /if \(criticalErrors\.length > 0\) scheduleFullLoadRetry\(\)/);
  assert.match(source, /useVmsDataStore\.getState\(\)\.load\(\)/);
});

test('logout limpa imediatamente os dados operacionais da sessão anterior', async () => {
  const source = await readFile(appPath, 'utf8');
  assert.match(source, /remove da memória os dados pertencentes à sessão anterior/);
  assert.match(source, /void loadData\(\)/);
});

test('publicação RTMP recém-chegada se recupera com limite, sem spinner infinito', async () => {
  const source = await readFile(playerPath, 'utf8');
  assert.match(source, /RTMP_SOURCE_AUTO_RETRY_LIMIT = 4/);
  assert.match(source, /rtmp_source_unavailable[\s\S]*retryAttemptRef\.current < RTMP_SOURCE_AUTO_RETRY_LIMIT[\s\S]*scheduleReconnect\('Aguardando transmissão RTMP da câmera'\)/);
  assert.match(source, /RTMP_SOURCE_BACKGROUND_RETRY_MS = 15_000/);
  assert.match(source, /scheduleRtmpBackgroundRecovery[\s\S]*setError\(message\)[\s\S]*setIsLoading\(false\)[\s\S]*RTMP_SOURCE_BACKGROUND_RETRY_MS/);
  assert.match(source, /rtmp_source_unavailable[\s\S]*scheduleRtmpBackgroundRecovery\(/);
});
