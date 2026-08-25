'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { guardar, listar, podar, caminhoDe } = require('../src/cofre-de-backup');

function raizTemporaria() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cofre-'));
}
const conteudo = (t) => Buffer.from(`dump-${t}`);

test('guarda e lista', async () => {
  const raiz = raizTemporaria();
  const r = await guardar(raiz, 'vibe', conteudo('a'), { agora: new Date('2026-08-25T10:00:00Z') });
  assert.match(r.nome, /^20260825T100000Z\.dump$/);
  assert.equal(r.bytes, 6);
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
  const itens = await listar(raiz, 'vibe');
  assert.equal(itens.length, 1);
});

test('lista do MAIS NOVO para o mais velho', async () => {
  const raiz = raizTemporaria();
  await guardar(raiz, 'x', conteudo('1'), { agora: new Date('2026-08-20T10:00:00Z') });
  await guardar(raiz, 'x', conteudo('2'), { agora: new Date('2026-08-25T10:00:00Z') });
  const itens = await listar(raiz, 'x');
  assert.match(itens[0].nome, /20260825/);
});

test('RETENÇÃO POR CONTAGEM: mantém os N mais recentes', async () => {
  const raiz = raizTemporaria();
  for (let d = 1; d <= 10; d += 1) {
    await guardar(raiz, 'x', conteudo(d), { agora: new Date(`2026-08-${String(d).padStart(2, '0')}T10:00:00Z`), manter: 3 });
  }
  const itens = await listar(raiz, 'x');
  assert.equal(itens.length, 3);
  assert.match(itens[0].nome, /20260810/, 'o mais novo sobrevive');
});

test('a retenção NÃO é por idade — instalação parada não perde tudo', async () => {
  // "apagar o que tem mais de 30 dias" apagaria todos os backups de uma
  // instalação que ficou um mês sem se comunicar — justamente quando eles
  // mais importam.
  const raiz = raizTemporaria();
  await guardar(raiz, 'parada', conteudo('antigo'), { agora: new Date('2020-01-01T10:00:00Z'), manter: 3 });
  await podar(raiz, 'parada', 3);
  assert.equal((await listar(raiz, 'parada')).length, 1);
});

test('cada envio é um arquivo NOVO — backup ruim não apaga o bom', async () => {
  const raiz = raizTemporaria();
  await guardar(raiz, 'x', conteudo('bom'), { agora: new Date('2026-08-25T10:00:00Z') });
  await guardar(raiz, 'x', conteudo('ruim'), { agora: new Date('2026-08-25T11:00:00Z') });
  assert.equal((await listar(raiz, 'x')).length, 2);
});

test('backup vazio é recusado', async () => {
  const raiz = raizTemporaria();
  await assert.rejects(() => guardar(raiz, 'x', Buffer.alloc(0)), /vazio/);
  await assert.rejects(() => guardar(raiz, 'x', 'não é buffer'), /vazio/);
});

test('backup gigante é recusado', async () => {
  const raiz = raizTemporaria();
  await assert.rejects(() => guardar(raiz, 'x', Buffer.alloc(65 * 1024 * 1024)), /excede/);
});

test('nome de instalação não escapa da pasta', async () => {
  const raiz = raizTemporaria();
  await guardar(raiz, '../../etc', conteudo('x'), { agora: new Date('2026-08-25T10:00:00Z') });
  // Vira um nome seguro DENTRO da raiz — nenhum diretório acima é tocado.
  const criados = fs.readdirSync(raiz);
  assert.equal(criados.length, 1);
  assert.equal(criados[0].includes('..'), false, 'nenhum ".." sobrevive no caminho');
  assert.equal(fs.existsSync(path.join(raiz, criados[0], '20260825T100000Z.dump')), true);
});

test('identificador que vira só underscores é RECUSADO', async () => {
  // "///" viraria "___" e todas as instalações escreveriam na mesma pasta.
  await assert.rejects(() => guardar(raizTemporaria(), '///', conteudo('x')), /inválido/);
});

test('nome de arquivo não escapa da pasta', () => {
  const raiz = raizTemporaria();
  assert.throws(() => caminhoDe(raiz, 'x', '../../../etc/passwd'), /inválido/);
  assert.throws(() => caminhoDe(raiz, 'x', 'qualquer.txt'), /inválido/);
  const ok = caminhoDe(raiz, 'x', '20260825T100000Z.dump');
  assert.equal(ok.startsWith(path.resolve(raiz)), true);
});

test('instalação sem backup devolve lista vazia, não erro', async () => {
  assert.deepEqual(await listar(raizTemporaria(), 'nunca-enviou'), []);
});
