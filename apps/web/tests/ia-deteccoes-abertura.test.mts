import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ler = (caminho: string) => readFileSync(caminho, 'utf8');
const semComentarios = (texto: string) => texto
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// FASE 1 DA REORGANIZAÇÃO DA IA (13/08/2026).
//
// A auditoria achou que a única tela em que a IA devolve valor visível — a fila
// de detecções, com foto, rótulo e clique que abre o vídeo — estava FORA do
// menu na web e DENTRO do menu no aplicativo. O mesmo cliente, nos dois
// dispositivos, via o sistema se contradizer.
//
// Estes testes travam as três decisões que resolveram isso. Todas são fáceis de
// desfazer sem querer numa refatoração, e nenhuma quebra em tempo de execução —
// só empobrece a tela em silêncio, que é o pior jeito de regredir.
// ─────────────────────────────────────────────────────────────────────────────

test('Detecções é a aba que ABRE a Inteligência', () => {
  // A ordem das abas é a ordem das perguntas: o operador abre a IA para ver o
  // que ela achou (todo dia), não para configurá-la (uma vez por câmera).
  const fonte = semComentarios(ler('src/pages/AiPage.tsx'));
  assert.match(fonte, /defaultValue="deteccoes"/, 'a Inteligência não abre em Detecções');
  const ordem = ['deteccoes', 'cameras', 'ajustes'].map((v) => fonte.indexOf(`'${v}'`));
  assert.ok(ordem[0] >= 0 && ordem[0] < ordem[1] && ordem[1] < ordem[2],
    'a ordem das abas deixou de ser Detecções → Câmeras → Ajustes');
});

test('a rota /review continua de pé — o app depende dela', () => {
  // O push com deep link do aplicativo aponta para /review. Trocar a rota
  // derrubaria a notificação de alarme de quem já tem o app instalado.
  const app = semComentarios(ler('src/App.tsx'));
  assert.match(app, /path="\/review"/, 'a rota /review sumiu e o deep link do app quebra');
});

test('a fila é UM componente montado em dois lugares, não duas cópias', () => {
  // Duas cópias divergiriam: um filtro novo entraria só na aba, e quem chegasse
  // pela notificação veria uma tela diferente.
  const painel = 'src/components/PainelDeDeteccoes.tsx';
  const pagina = ler('src/pages/ReviewPage.tsx');
  const aba = ler('src/pages/AiPage.tsx');
  assert.match(pagina, /PainelDeDeteccoes/, '/review não usa o painel compartilhado');
  assert.match(aba, /PainelDeDeteccoes/, 'a aba Detecções não usa o painel compartilhado');
  assert.match(ler(painel), /\/review\/feed/, 'o painel deixou de consumir a fila do backend');
  // A página é casca fina: se voltar a ter lógica, é sinal de cópia nascendo.
  assert.ok(pagina.split('\n').length < 25, 'ReviewPage voltou a carregar lógica própria');
});

test('o cabeçalho de página só aparece na ROTA, nunca dentro da aba', () => {
  // Como aba, o cabeçalho é da Inteligência — repetir daria dois títulos.
  const aba = semComentarios(ler('src/pages/AiPage.tsx'));
  assert.match(aba, /<PainelDeDeteccoes comCabecalho=\{false\}/, 'a aba está repetindo o cabeçalho');
  const pagina = semComentarios(ler('src/pages/ReviewPage.tsx'));
  assert.doesNotMatch(pagina, /comCabecalho=\{false\}/, 'a rota perdeu o próprio cabeçalho');
});

test('o contador de não-vistas aparece no menu e não custa nada sem IA', () => {
  // `/review/unseen-count` existia desde sempre e ninguém consumia. Agora tem
  // função — mas só faz sentido onde a IA foi contratada.
  const menu = semComentarios(ler('src/components/Sidebar.tsx'));
  assert.match(menu, /useDeteccoesNaoVistas\(aiFeatureEnabled\)/,
    'o contador deve ser buscado apenas quando a IA está contratada');
  assert.match(menu, /path === '\/ia' && contador/, 'o selo não está pendurado no item da IA');
});

test('o vocabulário novo entrou nas telas de IA', () => {
  // §10 dos padrões: três termos, e só três.
  const painel = semComentarios(ler('src/components/PainelDeDeteccoes.tsx'));
  assert.doesNotMatch(painel, /\brevis[ãa]/i, 'a palavra "revisão" voltou para a tela');
  const ai = semComentarios(ler('src/pages/AiPage.tsx'));
  assert.match(ai, /O que procurar/, 'a seção de classes não usa o termo do vocabulário');
});

test('a tela conta o que a IA descarta sozinha', () => {
  // O melhor do produto era invisível: supressão de luz piscando e de movimento
  // crônico não apareciam em lugar nenhum, e é o argumento contra o concorrente.
  const ai = ler('src/pages/AiPage.tsx');
  assert.match(ai, /descarta sozinha/i, 'a explicação do que é filtrado sumiu da tela');
  assert.match(ai, /pisca/i, 'não menciona a supressão de luz piscando');
});
