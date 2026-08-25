import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// "coloquei 3 dias e apliquei em todas! Depois fui na câmera, editar →
//  gravações, e aparece 3 dias que posso colocar 7 tranquilamente!"
//  (dono, 25/08/2026)
//
// Conseguia digitar — e não tinha efeito NENHUM. A tela salvava `retentionDays`
// e NÃO enviava `retentionFollowsGroup`, então a câmera continuava seguindo o
// grupo e o sistema seguia apagando aos 3 dias.
//
// Num sistema de segurança isso é alguém acreditar que tem 7 dias de prova e
// ter 3 — e só descobrir quando precisar da imagem.
// ─────────────────────────────────────────────────────────────────────────────

const RAIZ = join(process.cwd(), 'src');

function arquivosQueEditamRetencao(): string[] {
  const achados: string[] = [];
  const andar = (dir: string) => {
    for (const nome of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, nome.name);
      if (nome.isDirectory()) { andar(caminho); continue; }
      if (!/\.tsx?$/.test(nome.name)) continue;
      const texto = readFileSync(caminho, 'utf8');
      // Só interessa quem ESCREVE o valor, não quem apenas o exibe.
      if (/upd\('retentionDays'|updateField\('retentionDays'|retentionDays:\s*Number\(/.test(texto)) {
        achados.push(caminho);
      }
    }
  };
  andar(RAIZ);
  return achados;
}

test('QUEM EDITA os dias de retenção TEM de tratar o "seguir o grupo"', () => {
  const arquivos = arquivosQueEditamRetencao();
  assert.ok(arquivos.length >= 2, 'esperava achar ao menos as duas telas que editam retenção');

  const mudos = arquivos.filter((f) => !readFileSync(f, 'utf8').includes('retentionFollowsGroup'));
  assert.deepEqual(
    mudos.map((m) => m.replace(RAIZ, 'src')),
    [],
    'tela que edita os dias sem enviar o interruptor faz o campo MENTIR o prazo',
  );
});

test('a tela de editar câmera TRAVA o campo quando a câmera segue o grupo', () => {
  // Sem travar, o operador digita um número que o sistema ignora — que foi
  // exatamente o que aconteceu.
  const t = readFileSync(join(RAIZ, 'components/CameraEditSheet.tsx'), 'utf8');
  assert.match(t, /disabled=\{form\.retentionFollowsGroup\}/, 'o campo de dias precisa travar');
  assert.match(t, /onCheckedChange=\{\(v\) => upd\('retentionFollowsGroup', v\)\}/, 'o interruptor precisa existir');
  assert.match(t, /retentionFollowsGroup: form\.retentionFollowsGroup/, 'o valor precisa ser ENVIADO ao salvar');
});

test('as duas telas dizem quantos dias estão de fato valendo', () => {
  // Mostrar "3" num campo travado sem dizer de onde vem faz o operador achar
  // que é da câmera.
  const sheet = readFileSync(join(RAIZ, 'components/CameraEditSheet.tsx'), 'utf8');
  assert.match(sheet, /grupoRetentionDays/, 'precisa saber os dias do grupo para explicar');
  assert.match(sheet, /definidos no grupo/, 'precisa dizer de onde vem o número');
});
