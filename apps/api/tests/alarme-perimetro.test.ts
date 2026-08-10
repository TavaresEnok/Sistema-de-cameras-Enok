import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ── CRUZAR A LINHA TEM DE VIRAR ALARME ──────────────────────────────────────
// Bug real (10/08/2026): a linha de perímetro emite `LINE_CROSSED`, que não
// começa com AI_/ANALYTICS_ — então `inferSource` devolvia null e cruzar a
// linha só gravava um evento na timeline, SEM alarme e SEM push. A intenção de
// segurança MAIS explícita ("ninguém passa daqui") era a que MENOS avisava.
//
// inferSource/defaultPriorityFor são privados do módulo; inspeciona-se o fonte.

const SRC = readFileSync('src/alarms/alarms.service.ts', 'utf8');

test('LINE_CROSSED, INTRUSION e HUMAN viram fonte de alarme (ANALYTICS)', () => {
  const i = SRC.indexOf('EVENTOS_ANALITICOS');
  assert.ok(i > 0, 'precisa existir o conjunto de eventos analíticos alarmáveis');
  const bloco = SRC.slice(i, i + 400);
  for (const tipo of ['LINE_CROSSED', 'INTRUSION_DETECTED', 'HUMAN_DETECTED', 'OBJECT_DETECTED']) {
    assert.match(bloco, new RegExp(tipo), `${tipo} tem de gerar alarme (senão não avisa ninguém)`);
  }
  // E o conjunto tem de ser consultado dentro de inferSource.
  assert.match(SRC, /EVENTOS_ANALITICOS\.has\(type\)\)\s*return AlarmSource\.ANALYTICS/);
});

test('cruzar a linha / invadir área é P2 (mais urgente que detecção genérica)', () => {
  const i = SRC.indexOf('function defaultPriorityFor');
  const bloco = SRC.slice(i, i + 700);
  assert.match(bloco, /'LINE_CROSSED' \|\| type === 'INTRUSION_DETECTED'\) return AlarmPriority\.P2/,
    'perímetro é decisão consciente do operador — não pode nascer na prioridade mais baixa');
});
