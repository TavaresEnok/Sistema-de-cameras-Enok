import test from 'node:test';
import assert from 'node:assert/strict';
import {
  avaliarQualidadeDeRede,
  classificarFalhaDePlayer,
  mediana,
  registrarNoHistoricoDeRtt,
  type HistoricoDeRtt,
  type SinaisDeRede,
} from '../src/lib/qualidade-de-rede.ts';

// ── O AVISO NÃO PODE VIRAR DESCULPA ─────────────────────────────────────────
// O dono pediu o aviso "sua rede está instável" para não levarem a culpa pelo
// que é internet do cliente. O risco espelhado é PIOR: exibir esse aviso
// durante uma falha REAL do servidor esconde o defeito e manda o operador
// mexer no roteador à toa. Estes testes trancam os dois lados.

const base: SinaisDeRede = {
  online: true,
  apiRttMs: 80,
  bordaRttMs: 60,
  apiLentidaConfirmada: false,
  apiFalhasSeguidas: 0,
  streamsTotal: 0,
  streamsSemMidia: 0,
  streamsSemSinalizacao: 0,
};

test('tudo bem = nenhum aviso', () => {
  const d = avaliarQualidadeDeRede({ ...base, streamsTotal: 8 });
  assert.equal(d.nivel, 'ok');
  assert.equal(d.titulo, '');
});

test('placa de rede caída é local e sem ambiguidade', () => {
  const d = avaliarQualidadeDeRede({ ...base, online: false });
  assert.equal(d.nivel, 'offline');
  assert.equal(d.culpaDaRedeLocal, true);
  assert.match(d.detalhe, /gravações não são afetados|não são afetados/i);
});

test('CENTRAL: API rápida + vídeo não chega = rede DO USUÁRIO', () => {
  // Assinatura do incidente do dono: requisições pequenas voando, mosaico preto.
  const d = avaliarQualidadeDeRede({
    ...base,
    apiRttMs: 90,
    streamsTotal: 24,
    streamsSemMidia: 22,
  });
  assert.equal(d.nivel, 'instavel');
  assert.equal(d.culpaDaRedeLocal, true);
  assert.match(d.titulo, /sua conexão/i);
  // Tem de tranquilizar sobre a gravação — é a primeira dúvida do operador.
  assert.match(d.detalhe, /gravando/i);
});

test('API sem resposta NÃO culpa o usuário (pode ser o servidor)', () => {
  const d = avaliarQualidadeDeRede({ ...base, apiRttMs: null, apiFalhasSeguidas: 4 });
  assert.equal(d.nivel, 'servidor');
  assert.equal(d.culpaDaRedeLocal, false,
    'sem contato com a API não dá para saber de quem é a culpa — não acusar o cliente');
});

test('ANTES da primeira medição não existe aviso nenhum', () => {
  // Defeito real, visto em produção: `apiRttMs: null` também significa "a sonda
  // ainda não rodou". Tratar isso como falha fazia a faixa vermelha "Sem
  // comunicação com o servidor" piscar em TODA carga de página, com o sistema
  // perfeito. Alarme falso na abertura é o jeito mais rápido de ensinar o
  // operador a ignorar a faixa.
  const d = avaliarQualidadeDeRede({ ...base, apiRttMs: null, apiFalhasSeguidas: 0 });
  assert.equal(d.nivel, 'ok', 'sem medição ainda ≠ servidor fora');
});

test('uma falha isolada da sonda ainda não vira alarme', () => {
  const d = avaliarQualidadeDeRede({ ...base, apiRttMs: null, apiFalhasSeguidas: 1 });
  assert.equal(d.nivel, 'ok', 'só falha REPETIDA (>=3) acusa; soluço não conta');
});

test('falha na SINALIZAÇÃO é defeito do servidor, nunca "internet ruim"', () => {
  // Foi o caso de 11/08: a GPU sumiu, o MediaMTX não entregava stream nenhum.
  // Se o sistema dissesse "sua rede está instável", o dono procuraria o defeito
  // no lugar errado por horas.
  const d = avaliarQualidadeDeRede({
    ...base,
    apiRttMs: 60,
    streamsTotal: 24,
    streamsSemSinalizacao: 24,
    streamsSemMidia: 0,
  });
  assert.equal(d.nivel, 'servidor');
  assert.equal(d.culpaDaRedeLocal, false);
  assert.match(d.detalhe, /não é a sua conexão/i);
});

test('uma câmera ruim sozinha não acusa a rede inteira', () => {
  const d = avaliarQualidadeDeRede({
    ...base,
    streamsTotal: 24,
    streamsSemMidia: 2, // 8% — defeito daquelas câmeras, não da conexão
  });
  assert.equal(d.nivel, 'ok');
});

test('sem tela ao vivo aberta, o mosaico não influencia o diagnóstico', () => {
  const d = avaliarQualidadeDeRede({ ...base, streamsTotal: 0, streamsSemMidia: 0 });
  assert.equal(d.nivel, 'ok');
});

test('um pico lento isolado não vira alarme', () => {
  const d = avaliarQualidadeDeRede({ ...base, apiRttMs: 2400, apiLentidaConfirmada: false });
  assert.equal(d.nivel, 'ok');
});

test('API lenta confirmada e Nginx rápido aponta para o servidor', () => {
  const d = avaliarQualidadeDeRede({
    ...base,
    apiRttMs: 2400,
    bordaRttMs: 90,
    apiLentidaConfirmada: true,
  });
  assert.equal(d.nivel, 'servidor');
  assert.equal(d.culpaDaRedeLocal, false);
  assert.match(d.detalhe, /2400 ms/);
  assert.match(d.detalhe, /90 ms/);
});

test('API e acesso básico lentos usam mensagem neutra', () => {
  const d = avaliarQualidadeDeRede({
    ...base,
    apiRttMs: 2400,
    bordaRttMs: 1800,
    apiLentidaConfirmada: true,
  });
  assert.equal(d.nivel, 'lenta');
  assert.equal(d.culpaDaRedeLocal, false);
  assert.match(d.detalhe, /2400 ms/);
  assert.match(d.detalhe, /rede, o caminho da internet ou o servidor/i);
});

test('vídeo parado mas API JÁ lenta não vira acusação à última milha', () => {
  // Se até a requisição pequena está sofrendo, o problema é mais amplo; a
  // mensagem certa é "conexão lenta", não o diagnóstico específico de mídia.
  const d = avaliarQualidadeDeRede({
    ...base,
    apiRttMs: 1800,
    bordaRttMs: 1500,
    apiLentidaConfirmada: true,
    streamsTotal: 12,
    streamsSemMidia: 12,
  });
  assert.equal(d.nivel, 'lenta');
});

test('histórico usa mediana das cinco amostras e ignora outlier', () => {
  assert.equal(mediana([80, 82, 4_071, 79, 81]), 81);
});

test('alerta exige três lentas seguidas e recupera com duas normais', () => {
  let h: HistoricoDeRtt = {
    api: [], borda: [], lentasSeguidas: 0, saudaveisSeguidas: 0, lentidaConfirmada: false,
  };
  h = registrarNoHistoricoDeRtt(h, { apiRttMs: 1500, bordaRttMs: 80 });
  h = registrarNoHistoricoDeRtt(h, { apiRttMs: 1600, bordaRttMs: 80 });
  assert.equal(h.lentidaConfirmada, false);
  h = registrarNoHistoricoDeRtt(h, { apiRttMs: 1700, bordaRttMs: 80 });
  assert.equal(h.lentidaConfirmada, true);
  h = registrarNoHistoricoDeRtt(h, { apiRttMs: 100, bordaRttMs: 70 });
  assert.equal(h.lentidaConfirmada, true, 'uma boa ainda não apaga o aviso');
  h = registrarNoHistoricoDeRtt(h, { apiRttMs: 110, bordaRttMs: 70 });
  assert.equal(h.lentidaConfirmada, false);
});

// ── CLASSIFICAÇÃO DA FALHA DE CADA PLAYER ───────────────────────────────────
// É o insumo do diagnóstico. Errar aqui inverte a conclusão inteira.

test('a mensagem REAL de internet ruim conta como falta de mídia', () => {
  // Este é o texto que o dono viu na tela durante o episódio dele. A 1ª versão
  // procurava "MediaMTX" no texto e classificava como defeito do servidor —
  // mas a mensagem só CITA o MediaMTX como conselho de onde investigar.
  const erro = 'Nenhum protocolo iniciou. Verifique WebRTC/WHEP, HLS, codec da câmera e conectividade com o MediaMTX.';
  assert.equal(classificarFalhaDePlayer(erro, false, false), 'sem-midia');
});

test('timeout de entrega de vídeo é falta de mídia, não do servidor', () => {
  assert.equal(
    classificarFalhaDePlayer('HLS não entregou vídeo válido dentro do tempo limite.', false, false),
    'sem-midia');
  assert.equal(
    classificarFalhaDePlayer('WebRTC conectou, mas não entregou imagem (vídeo preto ou sem frames).', false, false),
    'sem-midia');
});

test('código HTTP de erro é recusa do servidor', () => {
  assert.equal(classificarFalhaDePlayer('Falha ao conectar WebRTC (400).', false, false), 'sem-sinalizacao');
  assert.equal(classificarFalhaDePlayer('Erro 503 ao abrir sessão', false, false), 'sem-sinalizacao');
});

test('falha de credencial é do servidor/câmera, não da rede do operador', () => {
  assert.equal(
    classificarFalhaDePlayer('Falha de autenticação da câmera: valide usuário/senha RTSP/ONVIF.', false, false),
    'sem-sinalizacao');
});

test('player carregando ainda não é falha', () => {
  assert.equal(classificarFalhaDePlayer(null, false, true), 'ok');
});

test('player com imagem é ok', () => {
  assert.equal(classificarFalhaDePlayer(null, true, false), 'ok');
});

test('o caminho COMPLETO do pedido do dono: internet ruim vira o aviso certo', () => {
  // Player relata pelo texto real → maioria sem mídia → API rápida → acusa a
  // rede local, que é o aviso que o dono pediu para não levar a culpa.
  const erro = 'Nenhum protocolo iniciou. Verifique WebRTC/WHEP, HLS, codec da câmera e conectividade com o MediaMTX.';
  const estados = Array.from({ length: 24 }, () => classificarFalhaDePlayer(erro, false, false));
  const d = avaliarQualidadeDeRede({
    online: true,
    apiRttMs: 85,
    bordaRttMs: 70,
    apiLentidaConfirmada: false,
    apiFalhasSeguidas: 0,
    streamsTotal: estados.length,
    streamsSemMidia: estados.filter((e) => e === 'sem-midia').length,
    streamsSemSinalizacao: estados.filter((e) => e === 'sem-sinalizacao').length,
  });
  assert.equal(d.nivel, 'instavel');
  assert.match(d.titulo, /sua conexão está instável/i);
});
