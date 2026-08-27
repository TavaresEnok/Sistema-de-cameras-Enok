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
// A lista de câmeras saiu da página e virou a aba "Câmeras"
// (`components/PainelDeCamerasDaIa.tsx`), que junta o que era só configuração
// com o ESTADO REAL de cada processador. As regras abaixo continuam valendo —
// mudou o arquivo onde moram, não o que protegem.
const PAINEL_CAMERAS = 'src/components/PainelDeCamerasDaIa.tsx';

test('a instalação NÃO pode escolher as classes de objeto', () => {
  // Se a tela oferecesse a escolha, o operador ampliaria sozinho o escopo do
  // que foi vendido — e cada classe extra custa CPU no servidor do cliente.
  const fonte = semComentarios(read(PAGINA));
  assert.doesNotMatch(fonte, /onChange[^}]*classe/i, 'a tela deixa editar classe');
  assert.doesNotMatch(fonte, /type="checkbox"[^>]*classe/i, 'há caixa de seleção de classe');
});

test('mas EXPLICA que a lista vem do provedor — senão o operador procura o botão', () => {
  const fonte = read(PAGINA);
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
  assert.match(fonte, /Mostrar quadrado no objeto/);
  assert.match(fonte, /a detecção continua igual/i, 'sem isso o operador teme desligar a detecção');
  assert.match(fonte, /aria-pressed=/, 'o alternador precisa anunciar estado');
});

test('cada câmera mostra POR QUE roda ou não', () => {
  // "Sem linha desenhada", "desligado pelo operador" e "não liberado para esta
  // instalação" pedem ações DIFERENTES; um interruptor apagado não diria qual.
  assert.match(read(PAGINA), /escopo-objeto/, 'a tela precisa consultar a decisão do backend');
  // Agora a explicação vem de DUAS fontes que se completam: o escopo diz por que
  // a busca por objeto roda ou não, e o estado diz se o processador está de pé.
  const painel = read(PAINEL_CAMERAS);
  assert.match(painel, /estadoDaIa\(/, 'o painel não traduz o estado do processador');
  assert.match(painel, /estado\.detalhe/, 'o painel não mostra a explicação ao operador');
});

test('os três modos por câmera estão disponíveis', () => {
  const fonte = read(PAINEL_CAMERAS);
  for (const modo of ['auto', 'sempre', 'nunca']) {
    assert.match(fonte, new RegExp(`value="${modo}"`), `falta o modo ${modo}`);
  }
  assert.match(fonte, /aria-label=/, 'o seletor por câmera precisa de rótulo acessível');
});

test('sem objeto liberado, os controles ficam desabilitados — não escondidos', () => {
  // Esconder faria parecer defeito; desabilitar com explicação mostra que a
  // função existe e depende de outra coisa.
  assert.match(read(PAINEL_CAMERAS), /disabled=\{!objetoLiberado\}/);
  assert.match(read(PAGINA), /Nenhum tipo de objeto liberado/);
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
