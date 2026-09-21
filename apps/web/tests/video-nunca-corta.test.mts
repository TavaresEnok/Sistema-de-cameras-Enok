import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// A visualização INDIVIDUAL e a reprodução preservam o quadro inteiro. A grade
// preenche tiles uniformes; antes disso, o backend tenta selecionar uma fonte
// com a mesma proporção da principal para evitar corte desnecessário.
//
// A grade usava `object-cover`, que preenche a célula CORTANDO as bordas. A
// justificativa registrada no código era estética: "some a borda preta e as
// imagens encaixam melhor".
//
// Num sistema de segurança isso é perda de imagem, e da pior espécie: o que se
// corta é a periferia da cena — onde alguém entra pelo lado, onde está a placa
// do carro parado no canto — e o operador não tem como perceber, porque a tela
// parece cheia e correta.
// ─────────────────────────────────────────────────────────────────────────────

const RAIZ = join(process.cwd(), 'src');
/** Logo/avatar e o mosaico ao vivo podem preencher a caixa. */
const PERMITIDOS = ['ui/item.tsx', 'components/LiveStreamPlayer.tsx'];

function arquivos(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const caminho = join(dir, e);
    if (statSync(caminho).isDirectory()) arquivos(caminho, acc);
    else if (/\.tsx$/.test(e)) acc.push(caminho);
  }
  return acc;
}

test('NENHUMA imagem de câmera ou gravação é cortada', () => {
  const culpados: string[] = [];
  for (const f of arquivos(RAIZ)) {
    if (PERMITIDOS.some((p) => f.endsWith(p))) continue;
    const texto = readFileSync(f, 'utf8');
    for (const linha of texto.split('\n')) {
      // Só conta uso REAL, não menção em comentário.
      const ehComentario = /^\s*(\/\/|\*|\/\*)/.test(linha);
      if (ehComentario) continue;
      if (!linha.includes('object-cover')) continue;
      // Logo do cliente pode cortar: é marca, não prova.
      if (/logo|Logo|avatar/i.test(linha)) continue;
      culpados.push(`${f.replace(RAIZ, 'src')}: ${linha.trim().slice(0, 70)}`);
    }
  }
  assert.deepEqual(culpados, [], 'cortar imagem de câmera esconde a periferia da cena');
});

test('o mosaico preenche o tile e a câmera individual preserva o quadro inteiro', () => {
  const t = readFileSync(join(RAIZ, 'components/LiveStreamPlayer.tsx'), 'utf8');
  assert.match(t, /liveViewMode === 'grid' \? 'object-cover' : 'object-contain'/);
  assert.match(t, /Na visualização individual usamos `contain`/);
});

test('o editor de zonas usa a proporção REAL da câmera', () => {
  // Defeito funcional, não estético: a caixa era fixa em 16:9 com a imagem
  // cortada, e as coordenadas do desenho são 0–100% DA CAIXA. Numa câmera 4:3,
  // a linha desenhada no meio da tela era gravada como "meio" — e o detector,
  // que analisa o quadro INTEIRO, encontrava esse meio em outro lugar da cena.
  const t = readFileSync(join(RAIZ, 'components/DetectionZonesEditor.tsx'), 'utf8');
  assert.match(t, /aspectRatio: proporcao/, 'a caixa segue a proporção da imagem');
  assert.match(t, /naturalWidth/, 'a proporção vem da imagem que chegou');
  assert.doesNotMatch(t, /style=\{\{ aspectRatio: '16 \/ 9' \}\}/, 'proporção fixa desalinha o desenho');
});
