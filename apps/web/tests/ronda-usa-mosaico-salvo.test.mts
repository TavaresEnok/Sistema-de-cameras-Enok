import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// "as grids de live/ não está tão bem sincronizadas com rondas" (dono, 25/08/2026)
//
// Eram DOIS desalinhamentos, e os dois vinham de a Ronda não usar o mosaico
// salvo:
//
//   1. lia `vmsDataStore.layouts` — que é UM mosaico gerado com todas as
//      câmeras, e com um identificador que o servidor não conhece. Salvar a
//      ronda daria erro, e a lista oferecia um mosaico que ninguém montou;
//   2. desenhava a grade pela raiz quadrada do número de câmeras, então um
//      mosaico 2×4 virava quadrado e as câmeras trocavam de lugar entre as
//      duas telas.
// ─────────────────────────────────────────────────────────────────────────────

const RONDA = readFileSync(join(process.cwd(), 'src/pages/RondaPage.tsx'), 'utf8');

test('a Ronda lê os mosaicos da MESMA fonte que o servidor valida', () => {
  assert.match(RONDA, /live-layouts/, 'precisa buscar na API de layouts');
  assert.doesNotMatch(
    RONDA,
    /useVmsDataStore\(\(s\) => s\.layouts\)/,
    'ler `vmsDataStore.layouts` traz o mosaico GERADO, não os do operador',
  );
});

test('a grade desenhada é a que foi SALVA', () => {
  assert.match(RONDA, /layout\?\.gridSize/, 'precisa usar o formato salvo');
  assert.doesNotMatch(
    RONDA,
    /Math\.sqrt\(/,
    'calcular colunas pela raiz quadrada ignora o formato e move as câmeras de lugar',
  );
});

test('posições VAZIAS do mosaico são preservadas', () => {
  // Quem deixou um buraco no canto o deixou de propósito. Compactar move todas
  // as câmeras seguintes, e quem decorou onde fica o portão perde a referência.
  assert.match(RONDA, /posicoes/, 'precisa montar a grade por posição, não por lista compactada');
});

test('a lista de mosaicos é buscada JUNTO com as rondas', () => {
  // Sem isso, a tela mostra "(mosaico apagado)" em paradas que existem, e o
  // operador acha que perdeu o trabalho.
  assert.match(RONDA, /Promise\.all\(\[/, 'as duas buscas precisam sair juntas');
});
