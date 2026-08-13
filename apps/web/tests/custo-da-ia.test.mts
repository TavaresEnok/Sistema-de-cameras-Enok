import assert from 'node:assert/strict';
import test from 'node:test';
import {
  custoEmNucleos,
  formatarCusto,
  custoTipico,
  custoTotal,
  descreverCusto,
} from '../src/lib/custo-da-ia.ts';

// A tela dizia "a detecção de objeto é cara" sem dizer quanto. Estes testes
// travam a única coisa que torna o número útil: ele sai de MEDIDA, e cala a
// boca quando não há medida — inventar custo para câmera que nunca rodou seria
// pior que admitir que ainda não se sabe.

test('custo é latência × frequência: 40 ms a 3 fps = 12% de um núcleo', () => {
  const n = custoEmNucleos({ inferAvgMs: 40, processFpsReal: 3 });
  assert.ok(n !== null);
  assert.ok(Math.abs(n! - 0.12) < 1e-9, `veio ${n}`);
  assert.equal(formatarCusto(n), '12% de um núcleo');
});

test('acima de um núcleo troca de unidade', () => {
  assert.equal(formatarCusto(custoEmNucleos({ inferAvgMs: 120, processFpsReal: 15 })), '1,8 núcleos');
});

test('sem medida devolve null — e null é resposta legítima', () => {
  assert.equal(custoEmNucleos(null), null);
  assert.equal(custoEmNucleos({}), null);
  assert.equal(custoEmNucleos({ inferAvgMs: 40 }), null, 'latência sem frequência não é custo');
  assert.equal(custoEmNucleos({ processFpsReal: 3 }), null);
  assert.equal(custoEmNucleos({ inferAvgMs: 0, processFpsReal: 3 }), null);
  assert.equal(formatarCusto(null), null);
});

test('medida corrompida não vira "1400% de um núcleo" com cara de fato', () => {
  // Relógio do container ou contador reiniciado produzem absurdo; devolver o
  // absurdo é pior que devolver nada.
  assert.equal(custoEmNucleos({ inferAvgMs: 5000, processFpsReal: 30 }), null);
  assert.equal(custoEmNucleos({ inferAvgMs: -40, processFpsReal: 3 }), null);
});

test('o típico é MEDIANA, não média', () => {
  // Uma cena excepcionalmente movimentada puxaria a média e faria a estimativa
  // mentir para todas as outras câmeras.
  const medidas = [
    { inferAvgMs: 40, processFpsReal: 3 },   // 0,12
    { inferAvgMs: 50, processFpsReal: 3 },   // 0,15
    { inferAvgMs: 60, processFpsReal: 3 },   // 0,18
    { inferAvgMs: 400, processFpsReal: 3 },  // 1,20 ← a exceção
  ];
  const tipico = custoTipico(medidas)!;
  assert.ok(Math.abs(tipico - 0.165) < 1e-9, `mediana esperada 0,165; veio ${tipico}`);
  const media = (0.12 + 0.15 + 0.18 + 1.2) / 4;
  assert.ok(tipico < media, 'a exceção não pode dominar a estimativa');
});

test('típico ignora quem não tem medida, em vez de contar como zero', () => {
  const t = custoTipico([{ inferAvgMs: 40, processFpsReal: 3 }, null, {}, { inferAvgMs: 60, processFpsReal: 3 }])!;
  assert.ok(Math.abs(t - 0.15) < 1e-9, `veio ${t}`);
  assert.equal(custoTipico([]), null);
  assert.equal(custoTipico([null, {}]), null);
});

test('total soma só o que está medido', () => {
  const total = custoTotal([{ inferAvgMs: 40, processFpsReal: 3 }, { inferAvgMs: 60, processFpsReal: 3 }, null])!;
  assert.ok(Math.abs(total - 0.30) < 1e-9, `veio ${total}`);
  assert.equal(custoTotal([]), null);
});

test('a frase separa MEDIDO de ESTIMADO', () => {
  // Um número medido justifica uma decisão; um estimado justifica uma tentativa.
  const rodando = descreverCusto({ medida: { inferAvgMs: 40, processFpsReal: 3 }, rodando: true })!;
  assert.equal(rodando.medido, true);
  assert.match(rodando.texto, /^Consome 12% de um núcleo$/);

  const parada = descreverCusto({ medida: null, tipicoDaInstalacao: 0.15, rodando: false })!;
  assert.equal(parada.medido, false);
  assert.match(parada.texto, /cerca de 15% de um núcleo/);
});

test('câmera parada usa o típico mesmo tendo medida velha guardada', () => {
  // A medida de quando ela rodava não descreve o agora; a estimativa é honesta.
  const r = descreverCusto({ medida: { inferAvgMs: 900, processFpsReal: 5 }, tipicoDaInstalacao: 0.15, rodando: false })!;
  assert.equal(r.medido, false);
  assert.match(r.texto, /15% de um núcleo/);
});

test('sem nada para dizer, não diz nada', () => {
  assert.equal(descreverCusto({ medida: null, tipicoDaInstalacao: null, rodando: false }), null);
});
