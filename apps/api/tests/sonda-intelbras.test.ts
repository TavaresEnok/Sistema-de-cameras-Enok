import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classificarResposta,
  lerParesChaveValor,
  resumirCatalogo,
} from '../src/cameras/helpers/sonda-intelbras.helper';

// ─────────────────────────────────────────────────────────────────────────────
// 17/08/2026: clientes de peso trarão câmeras analíticas Intelbras. Duas
// análises externas descreveram a integração LENDO DOCUMENTAÇÃO. Cinco minutos
// contra uma câmera real (VIPC-1230-B-G2, firmware 2.860.00IB000.0.R) já
// mostraram a divergência:
//
//   magicBox.cgi?action=getDeviceType     → 200  type=VIPC-1230-B-G2
//   devVideoAnalyse.cgi?action=getCaps    → 400  Bad Request!
//
// A segunda está no PDF e a câmera recusa. Catalogar o que ela DE FATO responde
// é o que evita escrever código para rotas inexistentes.
// ─────────────────────────────────────────────────────────────────────────────

test('lê a resposta real da câmera', () => {
  const v = lerParesChaveValor('type=VIPC-1230-B-G2\r\n');
  assert.equal(v.type, 'VIPC-1230-B-G2');
});

test('chave aninhada da família é preservada inteira', () => {
  // `table.General.LocalNo` não pode virar três níveis: a chave É o caminho.
  const v = lerParesChaveValor('table.General.LocalNo=1\r\ntable.General.MachineName=Cam-06');
  assert.equal(v['table.General.LocalNo'], '1');
  assert.equal(v['table.General.MachineName'], 'Cam-06');
});

test('valor com "=" dentro não é truncado', () => {
  const v = lerParesChaveValor('version=2.860.00IB000.0.R,build:2024-11-06=x');
  assert.equal(v.version, '2.860.00IB000.0.R,build:2024-11-06=x');
});

test('texto fora do formato NÃO vira entrada inventada', () => {
  assert.deepEqual(lerParesChaveValor('Error\r\nBad Request!'), {});
  assert.deepEqual(lerParesChaveValor(null), {});
});

test('o caso real: 200 com pares = capacidade suportada', () => {
  const c = classificarResposta('device.tipo', { status: 200, corpo: 'type=VIPC-1230-B-G2' });
  assert.equal(c.veredito, 'suportado');
  assert.equal(c.valores.type, 'VIPC-1230-B-G2');
});

test('o caso real: 400 = a câmera RECUSOU a rota', () => {
  const c = classificarResposta('analytics.caps', { status: 400, corpo: 'Error\r\nBad Request!' });
  assert.equal(c.veredito, 'nao-suportado');
  assert.match(c.explicacao, /não a atende|nao a atende/i);
});

test('200 com texto de erro é recusa DISFARÇADA', () => {
  // Parte dos firmwares responde 200 com "Error" no corpo. Tratar como sucesso
  // catalogaria capacidade que não existe.
  const c = classificarResposta('x', { status: 200, corpo: 'Error\r\nInvalid Authority!' });
  assert.equal(c.veredito, 'nao-suportado');
});

test('401 é falta de PERMISSÃO, não ausência de recurso', () => {
  const c = classificarResposta('x', { status: 401, corpo: 'Error\r\nInvalid Authority!' });
  assert.equal(c.veredito, 'sem-permissao');
  assert.match(c.explicacao, /credencial|perfil/i);
});

test('falha de rede NÃO vira "não suportado"', () => {
  // É o defeito que marcou 27 câmeras como sem PTZ quando o cliente é que não
  // sabia falar WS-Security. Aqui a distinção é explícita.
  const c = classificarResposta('x', { erro: 'timeout' });
  assert.equal(c.veredito, 'inalcancavel');
  assert.match(c.explicacao, /NÃO significa/i);
});

test('resposta aceita mas ilegível fica INDETERMINADA, não suportada', () => {
  const c = classificarResposta('x', { status: 200, corpo: '<xml>algo</xml>' });
  assert.equal(c.veredito, 'indeterminado');
  assert.match(c.explicacao, /crua/i);
});

test('o resumo separa o que a câmera negou do que não deu para perguntar', () => {
  const r = resumirCatalogo([
    classificarResposta('a', { status: 200, corpo: 'x=1' }),
    classificarResposta('b', { status: 400, corpo: 'Error' }),
    classificarResposta('c', { erro: 'timeout' }),
  ]);
  assert.equal(r.suportadas, 1);
  assert.equal(r.naoSuportadas, 1);
  assert.equal(r.inalcancaveis, 1);
  assert.equal(r.conclusivo, false, 'com algo inalcançável o catálogo NÃO é conclusivo');
});

test('catálogo sem falha de rede é conclusivo', () => {
  const r = resumirCatalogo([
    classificarResposta('a', { status: 200, corpo: 'x=1' }),
    classificarResposta('b', { status: 400, corpo: 'Error' }),
  ]);
  assert.equal(r.conclusivo, true);
});
