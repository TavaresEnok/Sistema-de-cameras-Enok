import assert from 'node:assert/strict';
import test from 'node:test';
import {
  rotuloDoEvento,
  filtrarPorObjeto,
  explicarResultado,
  OBJETOS_BUSCAVEIS,
} from '../src/lib/filtro-de-objeto.ts';

// Buscar por objeto na Reprodução é o motivo pelo qual alguém compra IA em vez
// de só gravar. O risco aqui é ESCONDER DEMAIS: um filtro que come marcas faz o
// operador concluir que não houve nada — e ele para de procurar.

const ev = (id: string, label?: string | null) => ({
  id, timestamp: '2026-08-13T10:00:00Z', severity: 'info', label: label ?? null,
});

test('sem filtro NADA é escondido, nem o evento sem rótulo', () => {
  // Movimento puro (a maioria) não tem rótulo. Filtrá-lo por engano esvaziaria
  // a régua de quase todas as câmeras.
  const eventos = [ev('a', 'pessoa'), ev('b'), ev('c', 'carro')];
  assert.equal(filtrarPorObjeto(eventos, null).length, 3);
});

test('com filtro, sobra só o rótulo pedido', () => {
  const eventos = [ev('a', 'pessoa'), ev('b'), ev('c', 'carro'), ev('d', 'pessoa')];
  const so = filtrarPorObjeto(eventos, 'pessoa');
  assert.deepEqual(so.map((e) => e.id), ['a', 'd']);
});

test('lê o rótulo do metadata cru sem quebrar com formato inesperado', () => {
  assert.equal(rotuloDoEvento({ semanticLabel: 'pessoa' }), 'pessoa');
  assert.equal(rotuloDoEvento({ semanticLabel: '  Carro ' }), 'carro', 'normaliza caixa e espaço');
  assert.equal(rotuloDoEvento({ semanticLabel: '' }), null);
  assert.equal(rotuloDoEvento({ outraCoisa: 1 }), null);
  assert.equal(rotuloDoEvento({ semanticLabel: 42 }), null, 'número não é rótulo');
  assert.equal(rotuloDoEvento(null), null);
  assert.equal(rotuloDoEvento('texto solto'), null);
  assert.equal(rotuloDoEvento(undefined), null);
});

test('vazio com filtro explica que o DIA não estava vazio', () => {
  // A distinção que muda a ação do operador: trocar o filtro, ou aceitar que
  // não houve nada.
  const frase = explicarResultado({ filtro: 'pessoa', totalNoDia: 42, totalFiltrado: 0 })!;
  assert.match(frase, /Nenhum\(a\) pessoa/);
  assert.match(frase, /42 outra/, 'não avisa que houve outras detecções');
  assert.match(frase, /Tire o filtro/, 'não diz o que fazer');
});

test('dia realmente vazio diz isso, sem culpar o filtro', () => {
  const frase = explicarResultado({ filtro: 'carro', totalNoDia: 0, totalFiltrado: 0 })!;
  assert.match(frase, /Nenhuma detecção neste dia/);
  assert.doesNotMatch(frase, /Tire o filtro/, 'sugerir tirar o filtro aqui seria conselho inútil');
});

test('com resultado, conta quantas', () => {
  const frase = explicarResultado({ filtro: 'pessoa', totalNoDia: 42, totalFiltrado: 7 })!;
  assert.match(frase, /7 marca\(s\) de pessoa/);
});

test('sem filtro não há nada a explicar', () => {
  assert.equal(explicarResultado({ filtro: null, totalNoDia: 42, totalFiltrado: 42 }), null);
});

test('as classes buscáveis batem com as que a fila de Detecções oferece', () => {
  // Divergir faria o operador achar na Reprodução um objeto que a fila não
  // filtra, ou o contrário.
  assert.deepEqual(OBJETOS_BUSCAVEIS.map((o) => o.valor), ['pessoa', 'carro', 'moto', 'onibus']);
});
