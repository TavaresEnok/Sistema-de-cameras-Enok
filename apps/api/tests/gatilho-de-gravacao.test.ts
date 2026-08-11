import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eventoDeveGravar, modoArmado, CLASSES_QUE_GRAVAM } from '../src/cameras/helpers/gatilho-de-gravacao.helper';

// ── GRAVAR POR OBJETO ────────────────────────────────────────────────────────
// Até 11/08/2026 o controller tinha UMA linha decidindo tudo:
//     if (dto.type === 'MOTION_DETECTED') handleMotionDetected(...)
// A IA já detectava pessoa e veículo, mas NADA disso gravava. O dono descobriu
// depois de eu recomendar três vezes um recurso que não existia.
//
// Esta é a regra mais cara de errar do sistema: um falso negativo aqui é
// gravação que NÃO EXISTE quando alguém precisa dela.

test('modo motion: segue gravando por movimento (comportamento histórico)', () => {
  assert.equal(eventoDeveGravar({ tipo: 'MOTION_DETECTED', modoDeGravacao: 'motion' }), true);
});

test('modo motion: objeto NÃO grava (não muda o que já existia)', () => {
  assert.equal(
    eventoDeveGravar({ tipo: 'OBJECT_DETECTED', modoDeGravacao: 'motion', rotulo: 'person' }),
    false,
    'ligar objeto no modo movimento duplicaria gravação sem ninguém pedir',
  );
});

test('modo object: pessoa e veículos gravam', () => {
  for (const classe of ['person', 'car', 'motorcycle', 'bus', 'truck', 'bicycle']) {
    assert.equal(
      eventoDeveGravar({ tipo: 'OBJECT_DETECTED', modoDeGravacao: 'object', rotulo: classe }),
      true,
      `${classe} deveria iniciar gravação`,
    );
  }
});

test('modo object: MOVIMENTO não grava — é exatamente o que se pediu para parar', () => {
  assert.equal(
    eventoDeveGravar({ tipo: 'MOTION_DETECTED', modoDeGravacao: 'object' }),
    false,
    'aceitar movimento aqui tornaria o modo objeto decorativo — sombra voltaria a gravar',
  );
});

test('modo object: classe irrelevante não grava', () => {
  // O modelo detecta muita coisa; só o que interessa a um VMS inicia gravação.
  for (const classe of ['bird', 'cat', 'chair', 'potted plant']) {
    assert.equal(
      eventoDeveGravar({ tipo: 'OBJECT_DETECTED', modoDeGravacao: 'object', rotulo: classe }),
      false,
      `${classe} não deveria iniciar gravação`,
    );
  }
});

test('modo object SEM rótulo: grava (na dúvida, guarda a imagem)', () => {
  // Descartar em silêncio é o defeito que ninguém percebe até precisar do vídeo.
  assert.equal(eventoDeveGravar({ tipo: 'OBJECT_DETECTED', modoDeGravacao: 'object' }), true);
  assert.equal(eventoDeveGravar({ tipo: 'OBJECT_DETECTED', modoDeGravacao: 'object', rotulo: '' }), true);
});

test('rótulo é comparado sem depender de caixa ou espaços', () => {
  assert.equal(
    eventoDeveGravar({ tipo: 'OBJECT_DETECTED', modoDeGravacao: 'object', rotulo: '  Person ' }),
    true,
  );
});

test('modos continuous/manual/desconhecido não mudam de comportamento', () => {
  for (const modo of ['continuous', 'manual', undefined, null, 'inventado']) {
    assert.equal(eventoDeveGravar({ tipo: 'MOTION_DETECTED', modoDeGravacao: modo as any }), true);
    assert.equal(eventoDeveGravar({ tipo: 'OBJECT_DETECTED', modoDeGravacao: modo as any, rotulo: 'person' }), false);
  }
});

test('a lista de classes cobre pessoa e os veículos que importam', () => {
  for (const classe of ['person', 'car', 'motorcycle', 'bus']) {
    assert.ok(CLASSES_QUE_GRAVAM.has(classe), `${classe} precisa estar na lista`);
  }
});

// ── FIAÇÃO: a regra precisa estar LIGADA no caminho real ────────────────────
// Uma função pura perfeita e não chamada é pior que nenhuma: o teste passa e o
// sistema não grava.

test('o controller usa a regra em vez do if literal antigo', () => {
  const src = readFileSync('src/cameras/cameras.controller.ts', 'utf8');
  assert.match(src, /eventoDeveGravar\(\{/, 'o gatilho tem de passar pelo helper');
  assert.doesNotMatch(
    src,
    /if \(dto\.type === 'MOTION_DETECTED'\) \{\s*\n\s*await this\.recordingManager/,
    'o if literal antigo não pode voltar — ele ignora o modo da câmera',
  );
});

test('o modo object ARMA o YOLO na câmera (senão nunca gravaria nada)', () => {
  // Sem detector de objeto ligado não existe OBJECT_DETECTED, e a câmera em
  // modo object ficaria em silêncio absoluto — o pior desfecho possível.
  const src = readFileSync('src/ai/helpers/escopo-de-objeto.helper.ts', 'utf8');
  assert.match(src, /recordingMode \?\? ''\) === 'object'/);
  assert.match(src, /motivo: 'gravacao-por-objeto'/);
});

test("'object' é aceito como modo de gravação nos DTOs", () => {
  for (const arquivo of ['src/cameras/dto/update-camera.dto.ts', 'src/cameras/dto/create-camera.dto.ts']) {
    const src = readFileSync(arquivo, 'utf8');
    assert.match(src, /RECORDING_MODES = \['continuous', 'motion', 'object', 'manual'\]/, arquivo);
  }
});

// ── MODO ARMADO: a mecânica de gravação vale para os DOIS ───────────────────
// A comparação literal `recordingMode === 'motion'` estava em 10 pontos do
// backend. Cada ponto esquecido ao acrescentar `object` vira um buraco
// silencioso: a câmera aceita o modo na tela e não grava — ou grava e nunca
// para, porque o post-roll não se reconhece como dono daquela gravação.

test('modoArmado cobre motion e object, e só eles', () => {
  assert.equal(modoArmado('motion'), true);
  assert.equal(modoArmado('object'), true);
  for (const m of ['continuous', 'manual', 'schedule', '', null, undefined]) {
    assert.equal(modoArmado(m as any), false, `${m} não é modo armado`);
  }
});

test('nenhum ponto crítico do backend voltou à comparação literal', () => {
  const criticos = [
    'src/recordings/recording-process-manager.service.ts',
    'src/ai/ai-manager.service.ts',
    'src/cameras/onvif-events.service.ts',
    'src/cameras/helpers/motion-detector.helper.ts',
  ];
  for (const arquivo of criticos) {
    const src = readFileSync(arquivo, 'utf8');
    const linhas = src.split('\n').filter((l) =>
      /recordingMode\s*(===|!==)\s*'motion'/.test(l) && !l.trim().startsWith('*') && !l.trim().startsWith('//'),
    );
    assert.equal(
      linhas.length, 0,
      `${arquivo} voltou a comparar 'motion' literal: ${linhas[0]?.trim()} — use modoArmado()`,
    );
  }
});

test('handleMotionDetected aceita câmera em modo object', () => {
  // É o portão final: sem ele o evento de objeto chega e a gravação é recusada.
  const src = readFileSync('src/recordings/recording-process-manager.service.ts', 'utf8');
  assert.match(src, /if \(!modoArmado\(camera\.recordingMode\)\) \{\s*\n\s*return \{ status: 'ignored', reason: 'motion_recording_not_enabled'/);
});
