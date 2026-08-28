import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparPorPosicao,
  ehEstimativa,
  explicacaoDoPonto,
  resumirMapa,
  rotuloDoPonto,
  temPosicao,
  agruparParaZoom,
  grausPorPixel,
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
  // Desde 28/08 a frase também explica que aproximar não vai separá-las —
  // era a dúvida do dono ao dar zoom e nada mudar.
  assert.match(explicacaoDoPonto(pontos[0]), /mesmo endereço/i);
  assert.match(explicacaoDoPonto(pontos[0]), /aproximar não as separa/i);
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

// ── 28/08/2026: agrupamento que respeita o zoom ─────────────────────────────
//
// "no zoom baixo aparece um símbolo com o número de câmeras, o que está
//  correto; mas ao aproximar deveria aparecer cada câmera no seu ponto/rua, e
//  continua como um símbolo grande" (dono)

test('APROXIMAR SEPARA: duas câmeras vizinhas juntam longe e separam perto', () => {
  // ~250 m de distância — duas ruas.
  const duas = [
    conferida('a', -8.0500, -34.8800, 'Rua A'),
    conferida('b', -8.0522, -34.8800, 'Rua B'),
  ];
  assert.equal(agruparParaZoom(duas, 11).length, 1, 'no zoom de cidade, viram um só');
  assert.equal(agruparParaZoom(duas, 17).length, 2, 'aproximando, cada uma no seu ponto');
});

test('MESMA COORDENADA: agrupa longe e abre cada câmera no zoom de rua', () => {
  // O caso real: 25 câmeras no mesmo chute de IP. A abertura no zoom alto é
  // visual e não transforma o deslocamento em endereço persistido.
  const frota = Array.from({ length: 25 }, (_, i) => estimada(String(i), -7.9408333, -34.8731087));
  for (const zoom of [3, 11, 17]) {
    const pontos = agruparParaZoom(frota, zoom);
    assert.equal(pontos.length, 1, `zoom ${zoom} mantém a contagem compacta`);
    assert.equal(pontos[0].mesmoPonto, true);
  }

  const abertos = agruparParaZoom(frota, 18);
  assert.equal(abertos.length, 25);
  assert.ok(abertos.every((p) => !p.agrupado && p.separadoVisualmente));
  assert.equal(new Set(abertos.map((p) => `${p.latitude}:${p.longitude}`)).size, 25);
  assert.match(explicacaoDoPonto(abertos[0]), /separado visualmente/i);
  assert.match(explicacaoDoPonto(abertos[0]), /não gravou este deslocamento/i);
});

test('o pixel vale menos grau conforme se aproxima', () => {
  assert.ok(grausPorPixel(10) > grausPorPixel(16), 'zoom maior = mais detalhe por pixel');
  assert.equal(grausPorPixel(0), 360 / 256);
  // Entrada estragada não vira NaN e não some com o mapa.
  assert.ok(Number.isFinite(grausPorPixel(Number.NaN)));
});

test('câmeras em cidades diferentes nunca se juntam, nem no zoom mais baixo', () => {
  const longe = [
    conferida('recife', -8.0538, -34.8813, 'Recife'),
    conferida('sp', -23.5505, -46.6333, 'São Paulo'),
  ];
  assert.equal(agruparParaZoom(longe, 4).length, 2);
});
