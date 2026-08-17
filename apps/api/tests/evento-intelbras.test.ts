import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ehAberturaDeIncidente,
  extrairBlocos,
  extrairObservacao,
  lerEvento,
  traduzirCodigo,
} from '../src/cameras/helpers/evento-intelbras.helper';

// ─────────────────────────────────────────────────────────────────────────────
// Câmeras Intelbras com IA embarcada não entregam analítico por ONVIF — o
// padrão só carrega alarme binário. Elas expõem `eventManager.cgi?action=attach`,
// um fluxo HTTP aberto que empurra cada disparo com o payload completo.
//
// Os payloads abaixo são os documentados pelo fabricante, usados aqui como
// fixação do contrato.
// ─────────────────────────────────────────────────────────────────────────────

const LINHA = `Code=CrossLineDetection;action=Start;index=0;data={
   "Class" : "Normal",
   "Direction" : "LeftToRight",
   "EventID" : 142,
   "Name" : "Cerca Perimetral",
   "ObjectType" : "Human",
   "UTC" : 1786982400
}`;

const PLACA = `Code=PlateDetection;action=Start;index=0;data={
   "BoundingBox" : [ 3100, 5200, 3900, 5600 ],
   "Confidence" : 98,
   "PlateColor" : "White",
   "PlateNumber" : "ABC1D23",
   "VehicleColor" : "Silver",
   "VehicleType" : "Sedan",
   "Speed" : 42,
   "UTC" : 1786982410
}`;

const ROSTO = `Code=FaceRecognition;action=Start;index=0;data={
   "Candidate" : { "PersonName" : "Carlos Eduardo", "Similarity" : 94, "ID" : "104" },
   "FaceData" : { "BoundingBox" : [ 1420, 2100, 1850, 2600 ], "Mask" : "No" },
   "UTC" : 1786982405
}`;

test('lê o evento de linha virtual, com direção e tipo de objeto', () => {
  const e = lerEvento(LINHA)!;
  assert.equal(e.codigo, 'CrossLineDetection');
  assert.equal(e.acao, 'Start');
  assert.equal(e.dados.Direction, 'LeftToRight');
  assert.equal(e.dados.ObjectType, 'Human');
});

test('o JSON contém ";" e "=" — cortar por separador destruiria o payload', () => {
  // A armadilha central do formato: `data=` vem por último e o resto é JSON.
  const comSeparadores = 'Code=X;action=Start;index=0;data={"Name":"a;b=c","UTC":1}';
  const e = lerEvento(comSeparadores)!;
  assert.equal(e.dados.Name, 'a;b=c');
  assert.equal(e.dados.UTC, 1);
});

test('bloco PARTIDO entre leituras da rede não vira evento perdido', () => {
  // Sem isto, um evento cortado no meio some sem erro nenhum.
  const inteiro = `\r\n--myboundary\r\n${LINHA}\r\n--myboundary\r\n${PLACA}`;
  const metade = inteiro.slice(0, 120);
  const r1 = extrairBlocos(metade);
  assert.equal(r1.blocos.length, 0, 'não pode entregar bloco incompleto');
  const r2 = extrairBlocos(r1.resto + inteiro.slice(120));
  assert.ok(r2.blocos.length >= 1, 'ao completar, o evento aparece');
  assert.equal(lerEvento(r2.blocos[0]!)!.codigo, 'CrossLineDetection');
});

test('o separador do multipart varia por firmware — a marca é o "--"', () => {
  const outro = `\r\n--OUTRAborda123\r\n${LINHA}\r\n--OUTRAborda123\r\n`;
  const r = extrairBlocos(outro);
  assert.equal(r.blocos.length, 1);
});

test('batimento e cabeçalho não viram evento', () => {
  assert.equal(lerEvento('Content-Type: text/plain'), null);
  assert.equal(lerEvento('HeartBeat'), null);
});

test('Start e Stop do MESMO objeto são um incidente só', () => {
  // Contar os dois duplicaria todo alarme.
  assert.equal(ehAberturaDeIncidente(lerEvento(LINHA)!), true);
  const parada = lerEvento(LINHA.replace('action=Start', 'action=Stop'))!;
  assert.equal(ehAberturaDeIncidente(parada), false);
});

test('placa: os campos consultáveis saem do payload', () => {
  // "Onde apareceu a placa ABC1D23" é impossível se isso ficar num Json
  // genérico, que é como o sistema guarda hoje.
  const o = extrairObservacao(lerEvento(PLACA)!);
  assert.equal(o.placa, 'ABC1D23');
  assert.equal(o.corDoVeiculo, 'Silver');
  assert.equal(o.velocidade, 42);
  assert.deepEqual(o.caixa, [3100, 5200, 3900, 5600]);
});

test('rosto: nome e similaridade vêm do candidato', () => {
  const o = extrairObservacao(lerEvento(ROSTO)!);
  assert.equal(o.pessoa, 'Carlos Eduardo');
  assert.equal(o.similaridade, 94);
  assert.deepEqual(o.caixa, [1420, 2100, 1850, 2600], 'a caixa do rosto está em FaceData');
});

test('campo ausente vira null, nunca string vazia ou zero', () => {
  // Zero é velocidade válida; string vazia é nome válido para um banco ruim.
  const o = extrairObservacao(lerEvento(LINHA)!);
  assert.equal(o.placa, null);
  assert.equal(o.velocidade, null);
  assert.equal(o.similaridade, null);
});

test('o relógio da CÂMERA viaja junto, não vira "agora"', () => {
  // Câmera com horário errado é comum; gravar o nosso relógio como se fosse o
  // dela apagaria a evidência da divergência.
  assert.equal(extrairObservacao(lerEvento(LINHA)!).ocorridoEm, 1786982400);
});

test('JSON quebrado guarda o CRU em vez de perder o evento', () => {
  const e = lerEvento('Code=X;action=Start;index=0;data={quebrado')!;
  assert.equal(e.codigo, 'X');
  assert.equal(e.dadosCrus, '{quebrado');
});

test('código conhecido é traduzido para o vocabulário do sistema', () => {
  assert.equal(traduzirCodigo('CrossLineDetection'), 'LINE_CROSSING');
  assert.equal(traduzirCodigo('PlateDetection'), 'PLATE_READ');
  assert.equal(traduzirCodigo('FaceRecognition'), 'FACE_RECOGNIZED');
});

test('código DESCONHECIDO preserva o nome do fabricante', () => {
  // Achatar para 'OTHER' é como se perde a inteligência que o cliente pagou.
  assert.equal(traduzirCodigo('AlgoNovoDoFirmware2027'), 'AlgoNovoDoFirmware2027');
});
