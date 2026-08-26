import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DESTINATARIOS,
  filtrarPosicoes,
  mosaicoTemAlgoAMostrar,
  normalizarDestinatarios,
  origemDe,
  pessoasAlcancadas,
  podeEditar,
  quadrosVisiveis,
} from '../src/live-layouts/helpers/compartilhamento.helper';

// "O administrador deve poder criar um mosaico/ronda e entregar para outras
//  pessoas, como a FullCam faz" (dono, 26/08/2026)

test('A REGRA QUE NÃO PODE CAIR: entregar mosaico não entrega câmera', () => {
  // O síndico monta um mosaico com quatro câmeras. Uma delas (cam-privada) é a
  // câmera particular de um morador, que só ele pode ver.
  const mosaico = ['cam-portao', 'cam-privada', 'cam-garagem', 'cam-hall'];
  const oQueOPorteiroPodeVer = new Set(['cam-portao', 'cam-garagem', 'cam-hall']);

  const visto = filtrarPosicoes(mosaico, oQueOPorteiroPodeVer);

  assert.deepEqual(visto, ['cam-portao', '', 'cam-garagem', 'cam-hall']);
});

test('A POSIÇÃO NÃO ANDA: o quadro escondido vira preto, os outros não sobem', () => {
  const mosaico = ['a', 'b', 'c', 'd'];
  const visto = filtrarPosicoes(mosaico, new Set(['a', 'd']));

  // 'd' continua no quarto quadro. Se ele tivesse subido para o segundo, duas
  // pessoas combinando "olha o quarto quadro" veriam câmeras diferentes.
  assert.equal(visto.length, 4);
  assert.equal(visto[3], 'd');
  assert.deepEqual(visto, ['a', '', '', 'd']);
});

test('quadro que já era vazio continua vazio, sem virar erro', () => {
  assert.deepEqual(filtrarPosicoes(['a', '', 'b'], new Set(['a', 'b'])), ['a', '', 'b']);
});

test('lista estragada não derruba a tela: vira mosaico vazio', () => {
  assert.deepEqual(filtrarPosicoes(null, new Set(['a'])), []);
  assert.deepEqual(filtrarPosicoes('nada disso', new Set(['a'])), []);
  assert.deepEqual(filtrarPosicoes([null, undefined, 42], new Set(['42'])), ['', '', '42']);
});

test('mosaico do qual não sobrou nada não deve ser entregue', () => {
  const nada = filtrarPosicoes(['x', 'y'], new Set(['outra']));
  assert.equal(quadrosVisiveis(nada), 0);
  assert.equal(mosaicoTemAlgoAMostrar(nada), false);

  const algo = filtrarPosicoes(['x', 'y'], new Set(['y']));
  assert.equal(quadrosVisiveis(algo), 1);
  assert.equal(mosaicoTemAlgoAMostrar(algo), true);
});

test('RECEBIDO É SÓ DE LEITURA: quem recebe usa, quem criou edita', () => {
  assert.equal(podeEditar({ donoId: 'ana', usuarioId: 'ana', ehAdmin: false }), true);
  assert.equal(podeEditar({ donoId: 'ana', usuarioId: 'bruno', ehAdmin: false }), false);
  // O admin edita para poder consertar mosaico de quem saiu da empresa.
  assert.equal(podeEditar({ donoId: 'ana', usuarioId: 'bruno', ehAdmin: true }), true);
});

test('a tela sabe dizer o que é meu e o que me deram', () => {
  assert.equal(origemDe({ donoId: 'ana', usuarioId: 'ana' }), 'meu');
  assert.equal(origemDe({ donoId: 'ana', usuarioId: 'bruno' }), 'recebido');
});

test('clicar duas vezes na mesma pessoa não derruba a gravação', () => {
  const d = normalizarDestinatarios({
    usuarios: ['ana', 'ana', ' ana ', 'bruno', '', null],
    grupos: ['g1', 'g1'],
  });
  assert.deepEqual(d.usuarios, ['ana', 'bruno']);
  assert.deepEqual(d.grupos, ['g1']);
});

test('sem destinatários = entrega para ninguém, não erro', () => {
  assert.deepEqual(normalizarDestinatarios(undefined), { usuarios: [], grupos: [] });
  assert.deepEqual(normalizarDestinatarios({ usuarios: 'x' }), { usuarios: [], grupos: [] });
});

test('teto de destinatários', () => {
  const muitos = Array.from({ length: MAX_DESTINATARIOS + 50 }, (_, i) => `u${i}`);
  assert.equal(normalizarDestinatarios({ usuarios: muitos }).usuarios.length, MAX_DESTINATARIOS);
});

test('o dono não conta como destinatário — senão "Usuários: N" mente', () => {
  const p = pessoasAlcancadas({
    donoId: 'sindico',
    usuariosDiretos: ['porteiro', 'sindico'],
    usuariosPorGrupo: ['zelador', 'porteiro'],
  });
  assert.deepEqual(p.sort(), ['porteiro', 'zelador']);
});
