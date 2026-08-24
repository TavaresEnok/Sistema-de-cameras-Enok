import test from 'node:test';
import assert from 'node:assert/strict';
import { podeCadastrarCamera, explicarTeto } from '../src/commercial-policy/helpers/teto-de-cameras.helper';

// "se dguardian dizer que vai pagar apenas para 50 cameras, eu tenho que
//  limitar pela central o cadastro de 50" (dono, 24/08/2026)

test('O CASO REAL: 50 contratadas, a 51ª é recusada', () => {
  assert.equal(podeCadastrarCamera(49, 50).permitido, true);
  const cheia = podeCadastrarCamera(50, 50);
  assert.equal(cheia.permitido, false);
  assert.equal(cheia.vagas, 0);
  assert.equal(cheia.motivo, 'teto-atingido');
});

test('SEM teto definido não trava ninguém', () => {
  // Campo esquecido no painel não pode travar cliente que pagou por mais.
  for (const semTeto of [null, undefined, '' as unknown as number, NaN]) {
    const d = podeCadastrarCamera(9999, semTeto as number);
    assert.equal(d.permitido, true, `teto ${semTeto} deveria liberar`);
    assert.equal(d.vagas, null);
  }
});

test('teto ZERO é um teto de verdade, não "sem teto"', () => {
  const d = podeCadastrarCamera(0, 0);
  assert.equal(d.permitido, false);
  assert.equal(d.motivo, 'teto-atingido');
});

test('quem JÁ passou do teto não cadastra mais, mas nada é apagado', () => {
  // Contrato reduzido depois do cadastro. Apagar imagem de cliente por questão
  // comercial é dano que não se desfaz.
  const d = podeCadastrarCamera(60, 50);
  assert.equal(d.permitido, false);
  assert.equal(d.motivo, 'acima-do-teto');
  assert.match(explicarTeto(d, 50), /Nenhuma câmera foi removida/);
});

test('cadastro em lote respeita as vagas restantes', () => {
  assert.equal(podeCadastrarCamera(48, 50, 2).permitido, true);
  assert.equal(podeCadastrarCamera(48, 50, 3).permitido, false);
});

test('a mensagem diz o número contratado', () => {
  assert.match(explicarTeto(podeCadastrarCamera(50, 50), 50), /50 câmeras/);
});

test('valores estranhos não viram permissão silenciosa', () => {
  assert.equal(podeCadastrarCamera(10, -1).motivo, 'sem-teto');
  assert.equal(podeCadastrarCamera(-5, 3).permitido, true, 'contagem negativa vira zero');
});

// ─────────────────────────────────────────────────────────────────────────────
// A ARMADILHA QUE ME PEGOU TRÊS VEZES EM UM DIA (24/08/2026).
//
// `Number(null)` e `Number('')` devolvem 0 em JavaScript, e 0 aqui significa
// "nenhuma câmera permitida". A primeira versão do conector gravou `0` na
// instalação Vibe e travou o cadastro de câmeras de um cliente que não tem teto
// nenhum. O mesmo tropeço apareceu no helper da Central e no da instalação.
//
// Estes casos ficam aqui porque a política de "vazio ≠ zero" é UMA só, e
// qualquer ponta que a reimplemente vai cair de novo.
// ─────────────────────────────────────────────────────────────────────────────

test('O ACIDENTE REAL: null da Central não pode virar teto zero', () => {
  const d = podeCadastrarCamera(3, null);
  assert.equal(d.permitido, true, 'null é SEM teto, nunca teto zero');
  assert.equal(d.motivo, 'sem-teto');
});

test('as formas de "sem teto" que o JavaScript transforma em zero', () => {
  for (const enganoso of [null, undefined, '', '   ']) {
    const d = podeCadastrarCamera(500, enganoso as unknown as number);
    assert.equal(d.permitido, true, `"${String(enganoso)}" NÃO pode bloquear cadastro`);
  }
});
