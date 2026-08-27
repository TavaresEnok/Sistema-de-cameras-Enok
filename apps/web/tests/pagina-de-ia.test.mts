import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');
const semComentarios = (t: string) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// Página de IA da instalação. A divisão que ela materializa:
//   CENTRAL      → O QUE pode ser detectado (classes) — escopo comercial
//   INSTALAÇÃO   → ONDE vale a pena pagar por isso e COMO aparece na tela
// Misturar os dois lados é o defeito que estes testes impedem.
// ─────────────────────────────────────────────────────────────────────────────

const PAGINA = 'src/pages/AiPage.tsx';

test('a instalação NÃO pode escolher as classes de objeto', () => {
  // Se a tela oferecesse a escolha, o operador ampliaria sozinho o escopo do
  // que foi vendido — e cada classe extra custa CPU no servidor do cliente.
  const fonte = semComentarios(read(PAGINA));
  assert.doesNotMatch(fonte, /onChange[^}]*classe/i, 'a tela deixa editar classe');
  assert.doesNotMatch(fonte, /type="checkbox"[^>]*classe/i, 'há caixa de seleção de classe');
});

test('mas EXPLICA que a lista vem do provedor — senão o operador procura o botão', () => {
  const fonte = read('src/components/ConfiguracaoFacilDaIa.tsx');
  assert.match(fonte, /painel central|provedor do sistema/i);
});

test('a configuração abre mesmo quando ainda não existe câmera', () => {
  const fonte = read('src/components/ConfiguracaoFacilDaIa.tsx');
  assert.doesNotMatch(fonte, /const iaObrigatoria = camera\.recordingMode/);
  assert.match(fonte, /Boolean\(camera &&/);
  assert.match(fonte, /Nenhuma câmera disponível/);
});

test('o "mostrar quadrado no objeto" existe e diz que não afeta a detecção', () => {
  const fonte = read(PAGINA);
  assert.match(fonte, /Marcação.*visível.*oculta/s);
  assert.match(fonte, /não altera a detecção/i, 'sem isso o operador teme desligar a detecção');
  assert.match(fonte, /aria-pressed=/, 'o alternador precisa anunciar estado');
});

test('a tela consulta o estado, mas traduz para ligado ou desligado', () => {
  assert.match(read(PAGINA), /escopo-objeto/, 'a tela precisa consultar a decisão do backend');
  const configuracao = read('src/components/ConfiguracaoFacilDaIa.tsx');
  assert.match(configuracao, /Detecção de objetos ativa/);
  assert.match(configuracao, /Detecção de objetos desligada/);
});

test('os três modos técnicos não aparecem na configuração comum', () => {
  const fonte = read('src/components/ConfiguracaoFacilDaIa.tsx');
  for (const modo of ['auto', 'sempre', 'nunca']) {
    assert.doesNotMatch(fonte, new RegExp(`value="${modo}"`), `o modo técnico ${modo} vazou`);
  }
  assert.match(fonte, /aria-label="Ativar ou desativar a IA nesta câmera"/);
});

test('sem objeto liberado, a tela explica a causa', () => {
  assert.match(read(PAGINA), /Detecção de objetos não liberada/);
  assert.match(read('src/components/ConfiguracaoFacilDaIa.tsx'), /não possui classes de objeto liberadas/);
});

test('precisão é uma barra percentual real, não três rótulos', () => {
  const fonte = read('src/components/ConfiguracaoFacilDaIa.tsx');
  assert.match(fonte, /<Slider/);
  assert.match(fonte, /min=\{55\}/);
  assert.match(fonte, /max=\{90\}/);
  assert.match(fonte, /aiConfidence/);
  assert.doesNotMatch(fonte, />Sensível<|>Equilibrada<|>Precisa</);
});

test('falha de rede não zera a tela', () => {
  // Cair no estado vazio faria o operador achar que a IA foi desconfigurada.
  const fonte = semComentarios(read(PAGINA));
  const trechoErro = fonte.slice(fonte.indexOf('catch (e)'), fonte.indexOf('finally'));
  assert.doesNotMatch(trechoErro, /setEscopo\(\[\]\)|setClasses\(\[\]\)/);
});

test('a preferência de caixa é compartilhada, não lida por tile', () => {
  // O player é renderizado uma vez POR CÂMERA: ler dentro dele viraria 17
  // requisições idênticas num mural.
  const store = read('src/store/aiPreferencesStore.ts');
  assert.match(store, /create<AiPreferencesState>/);
  assert.match(store, /if \(get\(\)\.carregado\) return;/, 'sem guarda, cada tile refaz a busca');

  const player = read('src/components/LiveStreamPlayer.tsx');
  assert.match(player, /useAiPreferencesStore/);
  assert.match(player, /showOverlay && aiEnabled && mostrarCaixa/, 'a preferência não gateia o desenho');
});

test('falha ao ler a preferência MOSTRA a marcação, não esconde', () => {
  // Esconder por falha de rede faria o operador achar que a detecção parou.
  const store = read('src/store/aiPreferencesStore.ts');
  assert.match(store, /showObjectBox: true/, 'o padrão precisa ser mostrar');
  const trechoCatch = store.slice(store.indexOf('} catch {'));
  assert.doesNotMatch(trechoCatch, /showObjectBox: false/);
});
