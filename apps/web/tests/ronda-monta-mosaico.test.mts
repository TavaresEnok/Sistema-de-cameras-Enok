import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// "não vi onde em rondas eu consigo criar novos mosaicos sem ir para a página
//  live" (dono, 26/08/2026)
//
// Ele tinha pedido isso desde o começo — "pode ser até as mesmas grids que
// ficam na tela de live, mas que também dá para modificar nessa tela" — e eu
// não implementei: a Ronda só listava mosaicos, obrigando a sair para montar.

const RONDA = readFileSync(join(process.cwd(), 'src/pages/RondaPage.tsx'), 'utf8');

test('dá para montar um mosaico SEM sair da Ronda', () => {
  assert.match(RONDA, /EditorDeMosaico/, 'a tela precisa ter o editor de mosaico');
  assert.match(RONDA, /Novo mosaico/, 'e um caminho visível para abrir ele');
});

test('o mosaico é salvo na MESMA lista do Ao Vivo', () => {
  // Lista própria da Ronda divergiria no primeiro ajuste, e o operador
  // montaria tudo duas vezes.
  assert.match(RONDA, /\/live-layouts`/, 'precisa salvar na API de layouts');
  assert.match(RONDA, /method: novo \? 'POST' : 'PATCH'/, 'criar e editar, no mesmo lugar');
});

test('a tela vazia oferece montar o primeiro mosaico', () => {
  // Antes dizia "monte um em Ao Vivo primeiro" — mandava o operador embora da
  // tela em que ele acabou de entrar.
  assert.match(RONDA, /Montar o primeiro/);
  assert.doesNotMatch(RONDA, /Monte um em Ao Vivo primeiro/, 'não mandar o operador para outra tela');
});

test('trocar o formato da grade PRESERVA as câmeras já posicionadas', () => {
  // Zerar faria o operador refazer o trabalho só por experimentar um formato.
  assert.match(RONDA, /posicoes\[i\] \?\? ''/, 'os slots vêm das posições já escolhidas');
});

test('a frase decorativa saiu do texto do usuário', () => {
  // "o portão merece mais que o corredor" era enfeite que não explicava nada.
  assert.doesNotMatch(RONDA, /merece mais que o corredor/);
});
