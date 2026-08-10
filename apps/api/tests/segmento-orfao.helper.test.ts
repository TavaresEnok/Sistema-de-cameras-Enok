import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  segmentoOrfaoObsoleto,
  IDADE_SEGMENTO_ORFAO_MS_PADRAO,
} from '../src/recordings/helpers/segmento-orfao.helper';

const AGORA = Date.parse('2026-08-10T16:00:00Z');
const H = 60 * 60 * 1000;

test('só .ts entra na regra — .mp4 e outros nunca', () => {
  // Um .mp4 antiquíssimo NÃO é órfão por aqui: é gravação de verdade, gerida
  // pelo banco e pela rotação. Confundir os dois apagaria acervo real.
  assert.equal(segmentoOrfaoObsoleto('gravacao.mp4', AGORA - 100 * H, AGORA), false);
  assert.equal(segmentoOrfaoObsoleto('foto.jpg', AGORA - 100 * H, AGORA), false);
  assert.equal(segmentoOrfaoObsoleto('2026-08-07_22-09-00.ts', AGORA - 100 * H, AGORA), true);
});

test('.ts velho é órfão; .ts recente (gravação ativa) é preservado', () => {
  // O caso real: segmento de 3 dias atrás vira lixo; o de agora está sendo
  // escrito e NÃO pode sumir.
  assert.equal(segmentoOrfaoObsoleto('velho.ts', AGORA - 72 * H, AGORA), true);
  assert.equal(segmentoOrfaoObsoleto('ativo.ts', AGORA - 2 * 60 * 1000, AGORA), false, 'de 2 min atrás: ativo');
  assert.equal(segmentoOrfaoObsoleto('recente.ts', AGORA - 1 * H, AGORA), false, '1h: ainda dentro da janela');
});

test('a fronteira é exatamente a idade máxima', () => {
  assert.equal(segmentoOrfaoObsoleto('borda.ts', AGORA - IDADE_SEGMENTO_ORFAO_MS_PADRAO, AGORA), true);
  assert.equal(segmentoOrfaoObsoleto('quase.ts', AGORA - (IDADE_SEGMENTO_ORFAO_MS_PADRAO - 1), AGORA), false);
});

test('janela configurável', () => {
  const umaHora = 1 * H;
  assert.equal(segmentoOrfaoObsoleto('x.ts', AGORA - 2 * H, AGORA, umaHora), true);
  assert.equal(segmentoOrfaoObsoleto('x.ts', AGORA - 30 * 60 * 1000, AGORA, umaHora), false);
});

test('sem prova de idade, não apaga (relógio torto, data inválida)', () => {
  // Arquivo "do futuro" (idade negativa) e datas não-finitas nunca disparam
  // remoção: a regra apaga por PROVA de obsolescência, não por dúvida.
  assert.equal(segmentoOrfaoObsoleto('futuro.ts', AGORA + 10 * H, AGORA), false);
  assert.equal(segmentoOrfaoObsoleto('nan.ts', Number.NaN, AGORA), false);
  assert.equal(segmentoOrfaoObsoleto('nan.ts', AGORA - 100 * H, Number.NaN), false);
});

test('maiúsculas na extensão também contam', () => {
  assert.equal(segmentoOrfaoObsoleto('SEG.TS', AGORA - 100 * H, AGORA), true);
});
