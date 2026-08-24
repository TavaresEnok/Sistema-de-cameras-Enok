import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// "tem que emitir o aviso apenas no sistema web e não para o app!" (dono,
//  24/08/2026)
//
// O aviso de licença é assunto de quem ADMINISTRA a instalação. Quem abre o
// aplicativo para ver a câmera de casa não tem o que fazer com "faltam 3 dias
// para bloquear" — e o pedido foi explícito.
//
// Sem esta rede, alguém acrescenta a chamada no app depois "para ficar
// completo", e o pedido se perde sem ninguém notar.
// ─────────────────────────────────────────────────────────────────────────────

const RAIZ_APP = join(process.cwd(), '..', 'mobile');
const IGNORAR = new Set(['node_modules', '.expo', 'android', 'ios', 'dist', 'build', '.git']);

function arquivosDe(dir: string, acc: string[] = []): string[] {
  let entradas: string[];
  try {
    entradas = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const nome of entradas) {
    if (IGNORAR.has(nome)) continue;
    const caminho = join(dir, nome);
    let info;
    try { info = statSync(caminho); } catch { continue; }
    if (info.isDirectory()) arquivosDe(caminho, acc);
    else if (/\.(ts|tsx|js|jsx)$/.test(nome)) acc.push(caminho);
  }
  return acc;
}

test('o APLICATIVO não consulta a rota de licença', () => {
  const arquivos = arquivosDe(RAIZ_APP);
  // Se o app sumir de lugar, o teste não pode passar em silêncio por não achar
  // arquivo nenhum — isso o tornaria inútil justamente quando mais importa.
  assert.ok(arquivos.length > 20, `esperava encontrar o código do app em ${RAIZ_APP}`);

  const culpados = arquivos.filter((f) => {
    const texto = readFileSync(f, 'utf8');
    return texto.includes('license/status') || texto.includes('AvisoDeLicenca');
  });
  assert.deepEqual(
    culpados.map((c) => c.replace(RAIZ_APP, 'apps/mobile')),
    [],
    'o aviso de licença deve existir SÓ no painel web',
  );
});

test('o PAINEL WEB mostra o aviso', () => {
  // O contrário também precisa de rede: remover o aviso do web por engano
  // deixaria o operador sem saber por que o sistema parou de gravar.
  const layout = readFileSync(join(process.cwd(), 'src/layouts/AppLayout.tsx'), 'utf8');
  assert.match(layout, /<AvisoDeLicenca\s*\/>/, 'o aviso deve estar montado no layout do painel');
  const componente = readFileSync(join(process.cwd(), 'src/components/AvisoDeLicenca.tsx'), 'utf8');
  assert.match(componente, /license\/status/, 'o aviso deve consultar a rota de licença');
});
