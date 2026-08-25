import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIAS_DE_CONVERSA_PADRAO,
  SEGUNDOS_ENTRE_ALERTAS,
  destinatariosDoAlerta,
  limparTexto,
  podeDispararAlerta,
  quandoExpira,
  textoDoAlerta,
} from '../src/group-chat/helpers/alerta-de-panico.helper';

// "cinco câmeras num condomínio, grupo Condomínio, dez usuários. Um deles vê
//  algo estranho, clica em ALERTA, e todos daquele grupo recebem push."
//  (dono, 25/08/2026)

const membro = (userId: string, tokens: string[] = [], ehAutor = false) => ({ userId, tokens, ehAutor });

test('O CASO REAL: dez moradores, um dispara, nove recebem', () => {
  const grupo = Array.from({ length: 10 }, (_, i) => membro(`u${i}`, [`ExponentPushToken[${i}]`], i === 3));
  const d = destinatariosDoAlerta(grupo);
  assert.equal(d.tokens.length, 9);
  assert.equal(d.alcancados, 9);
  assert.equal(d.tokens.includes('ExponentPushToken[3]'), false, 'quem disparou não recebe o próprio alerta');
});

test('morador SEM aparelho registrado não é erro — lê ao abrir o app', () => {
  // Tratar como falha faria o alerta parecer quebrado quando está correto.
  const d = destinatariosDoAlerta([membro('a', ['t1']), membro('b', []), membro('c', ['t2'], true)]);
  assert.equal(d.tokens.length, 1);
  assert.equal(d.semAparelho, 1);
});

test('aparelho repetido não recebe duas vibrações', () => {
  const d = destinatariosDoAlerta([membro('a', ['t1']), membro('b', ['t1', 't2'])]);
  assert.deepEqual(d.tokens.sort(), ['t1', 't2']);
});

test('grupo só com o autor não gera push nenhum', () => {
  assert.deepEqual(destinatariosDoAlerta([membro('a', ['t1'], true)]).tokens, []);
  assert.deepEqual(destinatariosDoAlerta([]).tokens, []);
});

test('a conversa expira em 3 dias por padrão', () => {
  const criada = new Date('2026-08-25T10:00:00Z');
  assert.equal(quandoExpira(criada, 3).toISOString(), '2026-08-28T10:00:00.000Z');
  assert.equal(DIAS_DE_CONVERSA_PADRAO, 3);
});

test('A ARMADILHA DO Number(null): ausente é o PADRÃO, nunca zero', () => {
  // Quarta aparição desta mesma cilada em 25/08/2026. `Number(null)` devolve 0
  // em JavaScript, e sem guarda a configuração ausente caía no piso de 1 dia —
  // a mensagem sumia dois dias antes do combinado.
  const c = new Date('2026-08-25T10:00:00Z');
  for (const ausente of [null, undefined, '' as unknown as number]) {
    assert.equal(
      quandoExpira(c, ausente as number).toISOString(),
      '2026-08-28T10:00:00.000Z',
      `"${String(ausente)}" deve cair no padrão de 3 dias`,
    );
  }
});

test('expiração tem piso e teto — zero apagaria antes de alguém ler', () => {
  const c = new Date('2026-08-25T10:00:00Z');
  assert.equal(quandoExpira(c, 0).toISOString(), '2026-08-26T10:00:00.000Z', 'piso de 1 dia');
  assert.equal(quandoExpira(c, -5).toISOString(), '2026-08-26T10:00:00.000Z');
  assert.equal(quandoExpira(c, 9999).toISOString(), '2026-11-23T10:00:00.000Z', 'teto de 90 dias');
  assert.equal(quandoExpira(c, 'muitos' as unknown as number).toISOString(), '2026-08-28T10:00:00.000Z');
});

test('o texto do push diz QUEM e ONDE, e nada mais', () => {
  const t = textoDoAlerta({ nomeDoGrupo: 'Condomínio', nomeDeQuemChamou: 'Maria', nomeDaCamera: 'Portaria' });
  assert.match(t.title, /Condomínio/);
  assert.match(t.body, /Maria/);
  assert.match(t.body, /Portaria/);
});

test('sem câmera indicada o texto continua fazendo sentido', () => {
  const t = textoDoAlerta({ nomeDoGrupo: 'Condomínio', nomeDeQuemChamou: 'João', nomeDaCamera: null });
  assert.equal(t.body.includes('—'), false);
  assert.match(t.body, /João pediu atenção\./);
});

test('FREIO contra repetição: o segundo toque em menos de um minuto não vira push', () => {
  // Sem freio, dez toques nervosos viram dez vibrações para dez pessoas — e na
  // próxima vez ninguém olha. O freio protege a credibilidade do alerta.
  const agora = Date.UTC(2026, 7, 25, 12, 0, 0);
  assert.equal(podeDispararAlerta(null, agora).pode, true, 'o primeiro sempre passa');
  assert.equal(podeDispararAlerta(agora - 5_000, agora).pode, false);
  assert.equal(podeDispararAlerta(agora - 5_000, agora).faltamSegundos, 55);
  assert.equal(podeDispararAlerta(agora - SEGUNDOS_ENTRE_ALERTAS * 1000, agora).pode, true);
});

test('texto é limpo e limitado — recado, não relatório', () => {
  assert.equal(limparTexto('  vi   alguém   pulando  '), 'vi alguém pulando');
  assert.equal(limparTexto('a'.repeat(900)).length, 500);
  assert.equal(limparTexto(null), '');
  assert.equal(limparTexto('linha1\n\nlinha2'), 'linha1 linha2');
});
