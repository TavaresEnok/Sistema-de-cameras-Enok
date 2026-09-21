import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/pages/LiveViewPage.tsx', import.meta.url), 'utf8');

test('a grade normal e o mural preservam células 16:9', () => {
  assert.match(
    source,
    /aspectRatio: `\$\{visibleGridCols \* 16\} \/ \$\{visibleGridRows \* 9\}`/,
    'a proporção combinada da grade deve seguir colunas e linhas 16:9',
  );
  assert.doesNotMatch(
    source,
    /style=\{wallMode\s*\?[^:]+aspectRatio/s,
    'a correção não pode ficar restrita ao modo mural',
  );
  assert.match(
    source,
    /flex-1 min-h-0 grid place-items-center bg-black/,
    'a sobra deve ser centralizada fora dos tiles',
  );
});
