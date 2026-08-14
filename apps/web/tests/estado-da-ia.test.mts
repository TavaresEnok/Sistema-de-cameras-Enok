import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estadoDaIa,
  formatarQuadrosPorSegundo,
  formatarAtrasoDoQuadro,
  resumirErro,
  resumoDaFrota,
  podeDesligarIa,
} from '../src/lib/estado-da-ia.ts';

// A decisão de estado da IA erra em SILÊNCIO: uma câmera parada anunciada como
// saudável é pior do que nenhuma informação — o operador confia e não olha.
// Por isso os testes cobrem principalmente os estados RUINS e a ordem em que
// as perguntas são feitas.

test('câmera analisando mostra os quadros por segundo reais', () => {
  const e = estadoDaIa({
    participation: { expectedToRun: true, blockedReason: null },
    runtime: { running: true, hibernating: false, lastError: null },
    stream: { inferenceFps: 3.24 },
  });
  assert.equal(e.chave, 'analisando');
  assert.equal(e.tom, 'ok');
  assert.match(e.detalhe, /3,2 quadros por segundo/, 'o número é o que separa "configurada" de "funcionando"');
});

test('câmera que DEVERIA analisar e não está aparece como problema, não como normal', () => {
  const e = estadoDaIa({
    participation: { expectedToRun: true, blockedReason: null },
    runtime: { running: false, lastError: null },
  });
  assert.equal(e.chave, 'parada');
  assert.equal(e.tom, 'erro');
  assert.equal(e.ofereceReiniciar, true);
});

test('câmera desligada pelo operador NÃO vira erro', () => {
  // A ordem das perguntas importa: perguntar "está rodando?" antes de "está
  // ligada?" acusaria de defeito uma câmera desligada de propósito.
  const e = estadoDaIa({
    participation: { expectedToRun: false, blockedReason: 'camera_ai_disabled' },
    runtime: { running: false },
  });
  assert.equal(e.chave, 'desligada');
  assert.equal(e.tom, 'neutro');
  assert.equal(e.ofereceReiniciar, false, 'não oferecer botão que não resolve');
  // A regra é a mesma — dizer ONDE resolver —, mas o lugar mudou: o botão
  // "Ligar" passou a existir na PRÓPRIA linha (14/08/2026), então mandar o
  // operador a outra tela virou conselho errado.
  assert.match(e.detalhe, /bot[ãa]o Ligar nesta linha/i, 'dizer ONDE resolver');
});

test('trava do servidor diz a verdade: não dá para resolver na tela', () => {
  const e = estadoDaIa({
    participation: { expectedToRun: false, blockedReason: 'filtered_by_ai_env' },
  });
  assert.equal(e.chave, 'restrita');
  assert.equal(e.ofereceReiniciar, false);
  assert.match(e.detalhe, /suporte/, 'sem botão mágico: o caminho é o suporte');
  assert.doesNotMatch(e.detalhe, /AI_ENABLED|env|variável/i, 'nome de variável de ambiente não vai para a tela');
});

test('erro vence "rodando" — detector em laço aparece rodando entre duas quedas', () => {
  const e = estadoDaIa({
    participation: { expectedToRun: true },
    runtime: { running: true, lastError: 'CUDA out of memory' },
  });
  assert.equal(e.chave, 'com-erro');
  assert.equal(e.tom, 'erro');
  assert.match(e.detalhe, /CUDA out of memory/);
});

test('em espera é estado NORMAL, não defeito', () => {
  const e = estadoDaIa({
    participation: { expectedToRun: true },
    runtime: { running: true, hibernating: true },
  });
  assert.equal(e.chave, 'em-espera');
  assert.equal(e.tom, 'neutro', 'hibernar economiza servidor — pintar de vermelho assustaria à toa');
  assert.match(e.detalhe, /acorda sozinha/);
});

test('motivo DESCONHECIDO não vira card em branco', () => {
  // Regra que faltou em telas anteriores e produziu "estado vazio" mudo.
  const e = estadoDaIa({
    participation: { expectedToRun: false, blockedReason: 'motivo_que_ainda_nao_existe' },
  });
  assert.ok(e.titulo.length > 0);
  assert.ok(e.detalhe.length > 0);
  assert.match(e.detalhe, /motivo_que_ainda_nao_existe/, 'mostrar o motivo cru é melhor que fingir que sabe');
});

test('sem resposta do servidor não é o mesmo que câmera parada', () => {
  const e = estadoDaIa(null);
  assert.equal(e.chave, 'indefinido');
  assert.equal(e.tom, 'neutro', 'ainda não sei ≠ está quebrado');
});

test('formata quadros por segundo em português, e omite o que não existe', () => {
  assert.equal(formatarQuadrosPorSegundo(3.24), '3,2 quadros por segundo');
  assert.equal(formatarQuadrosPorSegundo(10), '10,0 quadros por segundo');
  assert.equal(formatarQuadrosPorSegundo(0), null);
  assert.equal(formatarQuadrosPorSegundo(null), null);
  assert.equal(formatarQuadrosPorSegundo(undefined), null);
  assert.equal(formatarQuadrosPorSegundo(Number.NaN), null);
});

test('atraso do quadro troca de unidade quando passa de 1 segundo', () => {
  assert.equal(formatarAtrasoDoQuadro(240), '240 ms de atraso');
  assert.equal(formatarAtrasoDoQuadro(2400), '2,4 s de atraso');
  assert.equal(formatarAtrasoDoQuadro(0), null);
});

test('erro cru vira frase; erro gigante é cortado sem perder o começo', () => {
  assert.equal(resumirErro('  falha ao abrir o stream  '), 'falha ao abrir o stream');
  assert.equal(resumirErro('primeira linha\nstack trace\nmais stack'), 'primeira linha');
  const gigante = 'x'.repeat(300);
  const resumido = resumirErro(gigante)!;
  assert.ok(resumido.length <= 120, `veio com ${resumido.length}`);
  assert.ok(resumido.endsWith('…'));
  assert.equal(resumirErro(''), null);
  assert.equal(resumirErro(null), null);
});

test('resumo da frota responde em um olhar', () => {
  assert.equal(resumoDaFrota({ servicoOnline: true, rodando: 6, esperadas: 6 }).titulo, '6 câmeras sendo analisadas');
  assert.equal(resumoDaFrota({ servicoOnline: true, rodando: 1, esperadas: 1 }).titulo, '1 câmera sendo analisada');
  assert.equal(resumoDaFrota({ servicoOnline: true, rodando: 4, esperadas: 6 }).titulo, '4 de 6 câmeras sendo analisadas');
  assert.equal(resumoDaFrota({ servicoOnline: true, rodando: 4, esperadas: 6 }).tom, 'atencao');
  assert.equal(resumoDaFrota({ servicoOnline: true, rodando: 0, esperadas: 6 }).tom, 'erro', 'nenhuma rodando é alarme, não aviso');
  assert.equal(resumoDaFrota({ servicoOnline: true, rodando: 0, esperadas: 0 }).tom, 'neutro', 'ninguém ligou IA ainda: não é falha');
  assert.equal(resumoDaFrota({ servicoOnline: false }).tom, 'erro');
  assert.match(resumoDaFrota({ servicoOnline: false }).titulo, /fora do ar/);
});

// ── Desligar a IA: quando é permitido ───────────────────────────────────────

test('câmera que grava por movimento do SISTEMA não pode ter a IA desligada', () => {
  // Gêmea da regra do backend. Custou 7 câmeras ONLINE e mudas por 10 horas:
  // o gerenciador tentava subir a análise, achava o detector desligado, e
  // desistia a cada 5 minutos — sem nada na tela indicando problema.
  const r = podeDesligarIa({ recordingMode: 'motion', motionTrigger: 'SYSTEM' });
  assert.equal(r.pode, false);
  assert.match(r.motivo!, /aba Gravação/, 'não diz ONDE resolver');
});

test('modo objeto também depende do detector do sistema', () => {
  assert.equal(podeDesligarIa({ recordingMode: 'object', motionTrigger: 'SYSTEM' }).pode, false);
});

test('gravação contínua ou gatilho da CÂMERA: pode desligar', () => {
  // Contínua não depende de detector; CAMERA usa o da própria câmera. Forçar o
  // MOG2 nesses casos gastaria CPU sem nada em troca.
  assert.equal(podeDesligarIa({ recordingMode: 'continuous', motionTrigger: 'SYSTEM' }).pode, true);
  assert.equal(podeDesligarIa({ recordingMode: 'motion', motionTrigger: 'CAMERA' }).pode, true);
  assert.equal(podeDesligarIa({ recordingMode: 'manual', motionTrigger: 'SYSTEM' }).pode, true);
  assert.equal(podeDesligarIa({}).pode, true);
});
