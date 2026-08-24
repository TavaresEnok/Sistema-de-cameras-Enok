import test from 'node:test';
import assert from 'node:assert/strict';
import {
  serializarValor,
  ValorDeConfiguracaoInvalido,
} from '../src/settings/helpers/valor-de-configuracao.helper';

// ─────────────────────────────────────────────────────────────────────────────
// 24/08/2026, instalação Córtex: "Quando cliquei em salvar na aparência
// 'Failed to load resource: the server responded with a status of 400'".
//
// A tela envia o objeto INTEIRO de configurações. Uma chave recusada derruba o
// salvamento todo, e o operador só vê "Falha ao salvar". A chave era
// `hiddenNavPaths`, cujo padrão É vazio — então o Salvar estava quebrado em toda
// instalação que não esconde item de menu, a principal inclusive.
// ─────────────────────────────────────────────────────────────────────────────

test('O CASO REAL: campo de texto com padrão VAZIO aceita vazio', () => {
  assert.equal(serializarValor('hiddenNavPaths', '', { type: 'string', default: '' }), '');
  assert.equal(serializarValor('hiddenNavPaths', undefined, { type: 'string', default: '' }), '');
});

test('campo de texto com padrão PREENCHIDO continua exigindo conteúdo', () => {
  // É o que impede apagar sem querer o nome da instalação.
  assert.throws(
    () => serializarValor('facilityName', '', { type: 'string', default: 'AjustCam' }),
    ValorDeConfiguracaoInvalido,
  );
});

test('texto é aparado e limitado a 200 caracteres', () => {
  assert.equal(serializarValor('x', '  /alarms,/review  ', { type: 'string', default: '' }), '/alarms,/review');
  assert.equal(serializarValor('x', 'a'.repeat(500), { type: 'string', default: '' }).length, 200);
});

test('cor vazia é válida — significa voltar ao padrão do tema', () => {
  assert.equal(serializarValor('systemPrimaryColor', '', { type: 'color', default: '' }), '');
});

test('cor fora do formato #RRGGBB é recusada', () => {
  for (const ruim of ['roxo', '#FFF', '8B5CF6', '#8B5CF6AA']) {
    assert.throws(
      () => serializarValor('systemPrimaryColor', ruim, { type: 'color', default: '' }),
      ValorDeConfiguracaoInvalido,
      `deveria recusar ${ruim}`,
    );
  }
});

test('cor válida é normalizada para minúsculas', () => {
  assert.equal(serializarValor('c', '#8B5CF6', { type: 'color', default: '' }), '#8b5cf6');
});

test('imagem vazia é válida — remove o logo', () => {
  assert.equal(serializarValor('systemLogoDataUrl', '', { type: 'image', default: '' }), '');
});

test('imagem que não é data URL é recusada', () => {
  assert.throws(
    () => serializarValor('systemLogoDataUrl', 'https://exemplo/logo.png', { type: 'image', default: '' }),
    ValorDeConfiguracaoInvalido,
  );
});

test('número é arredondado e preso entre mínimo e máximo', () => {
  const spec = { type: 'number' as const, default: 30, min: 1, max: 90 };
  assert.equal(serializarValor('n', 45.6, spec), '46');
  assert.equal(serializarValor('n', 999, spec), '90');
  assert.equal(serializarValor('n', -5, spec), '1');
});

test('número não numérico é recusado', () => {
  assert.throws(
    () => serializarValor('n', 'muitos', { type: 'number', default: 1 }),
    ValorDeConfiguracaoInvalido,
  );
});

test('booleano aceita as formas que chegam de formulário e de JSON', () => {
  const spec = { type: 'boolean' as const, default: true };
  for (const v of [true, 'true', 1, '1']) assert.equal(serializarValor('b', v, spec), 'true');
  for (const v of [false, 'false', 0, '', null, undefined]) assert.equal(serializarValor('b', v, spec), 'false');
});
