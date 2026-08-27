import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparPorPosicao,
  ehEstimativa,
  explicacaoDoPonto,
  resumirMapa,
  rotuloDoPonto,
  temPosicao,
} from '../src/lib/posicao-no-mapa.ts';

// "verifique se a geolocalização automática está sendo feita corretamente
//  pegando o local exato da câmera!" (dono, 27/08/2026)
//
// Não estava: as 29 câmeras desta frota foram posicionadas por estimativa de IP
// e caíram em DOIS pontos. A tela as espalhava num leque de ~130 m, fazendo
// chute parecer medida.

const estimada = (id: string, lat: number, lon: number) => ({
  id, name: `Cam-${id}`, latitude: lat, longitude: lon,
  locationAddress: 'Estimativa por IP público da câmera — Paulista, Pernambuco, Brasil',
});
const conferida = (id: string, lat: number, lon: number, endereco: string) => ({
  id, name: `Cam-${id}`, latitude: lat, longitude: lon, locationAddress: endereco,
});

test('A REGRA: estimativa NÃO é espalhada — vira um ponto com a contagem', () => {
  // O caso real: 25 câmeras no mesmo chute de IP.
  const frota = Array.from({ length: 25 }, (_, i) => estimada(String(i), -7.9408, -34.8731));
  const pontos = agruparPorPosicao(frota);

  assert.equal(pontos.length, 1, 'vinte e cinco chutes iguais são UM ponto, não vinte e cinco');
  assert.equal(pontos[0].cameras.length, 25);
  assert.equal(pontos[0].agrupado, true);
  assert.equal(pontos[0].estimado, true);
  assert.equal(rotuloDoPonto(pontos[0]), '25 câmeras');
});

test('o ponto estimado DIZ que é estimado', () => {
  const pontos = agruparPorPosicao([estimada('a', -7.94, -34.87)]);
  assert.match(explicacaoDoPonto(pontos[0]), /estimada pela rede/i);
  assert.match(explicacaoDoPonto(pontos[0]), /não está necessariamente aqui/i);
  assert.match(explicacaoDoPonto(pontos[0]), /informe o endereço/i);
});

test('endereço conferido é apresentado como o que é', () => {
  const pontos = agruparPorPosicao([conferida('a', -8.05, -34.88, 'Rua do Sol, 100 — Recife')]);
  assert.equal(pontos[0].estimado, false);
  assert.equal(explicacaoDoPonto(pontos[0]), 'Rua do Sol, 100 — Recife');
});

test('UMA câmera conferida no grupo já tira o aviso de estimativa', () => {
  // Senão a tela chamaria de "chute" uma posição que alguém conferiu.
  const pontos = agruparPorPosicao([
    estimada('a', -7.94, -34.87),
    conferida('b', -7.94, -34.87, 'Av. Central, 50'),
  ]);
  assert.equal(pontos.length, 1);
  assert.equal(pontos[0].estimado, false);
  assert.equal(explicacaoDoPonto(pontos[0]), 'Câmeras no mesmo endereço.');
});

test('câmeras em lugares DIFERENTES continuam separadas', () => {
  const pontos = agruparPorPosicao([
    conferida('a', -8.0538, -34.8813, 'Recife'),
    conferida('b', -7.9408, -34.8731, 'Paulista'),
  ]);
  assert.equal(pontos.length, 2);
  assert.ok(pontos.every((p) => !p.agrupado));
});

test('o carimbo do servidor é o que distingue chute de medida', () => {
  assert.equal(ehEstimativa({ id: '1', name: 'x', locationAddress: 'Estimativa por IP público da instalação — Recife' }), true);
  assert.equal(ehEstimativa({ id: '1', name: 'x', locationAddress: '  Estimativa por IP público da câmera — X' }), true);
  assert.equal(ehEstimativa({ id: '1', name: 'x', locationAddress: 'Rua Estimativa, 20' }), false);
  assert.equal(ehEstimativa({ id: '1', name: 'x', locationAddress: null }), false);
  assert.equal(ehEstimativa({ id: '1', name: 'x' }), false);
});

test('câmera sem coordenada não entra no mapa nem inventa ponto', () => {
  assert.equal(temPosicao({ id: '1', name: 'x' }), false);
  assert.equal(temPosicao({ id: '1', name: 'x', latitude: null, longitude: null }), false);
  assert.equal(temPosicao({ id: '1', name: 'x', latitude: -8, longitude: null }), false);
  assert.equal(agruparPorPosicao([{ id: '1', name: 'x' }]).length, 0);
});

test('a faixa do topo conta a verdade da frota', () => {
  const r = resumirMapa([
    estimada('a', -7.94, -34.87),
    estimada('b', -7.94, -34.87),
    conferida('c', -8.05, -34.88, 'Rua X'),
    { id: 'd', name: 'sem posição' },
  ]);
  assert.deepEqual(r, { total: 4, comPosicao: 3, semPosicao: 1, estimadas: 2, conferidas: 1 });
});

test('o CASO REAL desta instalação, ponta a ponta', () => {
  const frota = [
    ...Array.from({ length: 25 }, (_, i) => estimada(`p${i}`, -7.9408, -34.8731)),
    ...Array.from({ length: 4 }, (_, i) => estimada(`r${i}`, -8.0538, -34.8813)),
  ];
  const pontos = agruparPorPosicao(frota);
  assert.equal(pontos.length, 2, 'dois chutes de IP são dois pontos no mapa');
  assert.deepEqual(pontos.map((p) => p.cameras.length).sort((a, b) => b - a), [25, 4]);
  assert.ok(pontos.every((p) => p.estimado));
  const r = resumirMapa(frota);
  assert.equal(r.estimadas, 29);
  assert.equal(r.conferidas, 0);
});
