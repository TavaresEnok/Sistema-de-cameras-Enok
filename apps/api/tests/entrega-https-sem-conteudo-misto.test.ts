import test from 'node:test';
import assert from 'node:assert/strict';
import { MediamtxProxyService } from '../src/camera-stream/mediamtx-proxy.service';

// ── PÁGINA HTTPS NÃO PODE RECEBER URL DE VÍDEO http://IP:PORTA ───────────────
//
// Diagnosticado no D-GUARDIAN (12/08/2026): a Camera-teste-01 ficava eterna em
// "Conectando" sem imagem. O stream estava PERFEITO (provado: com token, o
// runOnDemand disparava e o path publicava 1080p H264+Opus). O defeito era a
// URL de ENTREGA: a página abre em https://<domínio>, mas o WHEP era anunciado
// como http://<IP>:8889 — e o navegador BLOQUEIA "http dentro de https"
// (conteúdo misto). A requisição nem saía; o servidor não via nada.
//
// A única URL que um navegador em página HTTPS aceita é a MESMA ORIGEM, atrás
// do nginx (que repassa /webrtc/→8889 e /hls/→8888). Estes testes garantem que
// nunca mais se emita uma URL de mídia que o navegador vá recusar.

function servico(config: Record<string, unknown>) {
  const svc: any = Object.create(MediamtxProxyService.prototype);
  svc.isEnabled = () => true;
  svc.configService = { get: (k: string) => config[k] };
  return svc as MediamtxProxyService;
}

function req(headers: Record<string, string>) {
  return { headers, protocol: headers['x-forwarded-proto'] ?? 'http' } as any;
}

const PORTAS = { mediaMtxWebrtcPort: 8889, mediaMtxHlsPort: 8888 };

test('sob HTTPS, entrega é MESMA ORIGEM por caminho (sem porta, sem http)', () => {
  const svc = servico({ ...PORTAS });
  const urls = svc.buildPublicUrls(
    req({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'dguardian.ajustconsulting.com.br' }),
    'cam_abc',
    null,
  );
  assert.equal(urls.whepUrl, 'https://dguardian.ajustconsulting.com.br/webrtc/cam_abc/whep');
  assert.equal(urls.hlsUrl, 'https://dguardian.ajustconsulting.com.br/hls/cam_abc/index.m3u8');
});

test('sob HTTPS, NENHUMA url de mídia é conteúdo misto (http:// ou :porta)', () => {
  // A regressão mais cara: a URL parece certa mas o navegador a recusa calado.
  const svc = servico({ ...PORTAS, mediaMtxPublicHost: '168.194.13.20', mediaMtxPublicScheme: 'http' });
  const urls = svc.buildPublicUrls(
    req({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'cliente.exemplo.com.br' }),
    'cam_abc',
    null,
  );
  for (const u of [urls.whepUrl, urls.webrtcUrl, urls.hlsUrl]) {
    assert.doesNotMatch(String(u), /^http:\/\//, `mídia em http numa página https é bloqueada: ${u}`);
    assert.doesNotMatch(String(u), /:8889|:8888/, `porta direta não tem TLS numa página https: ${u}`);
    assert.match(String(u), /^https:\/\/cliente\.exemplo\.com\.br\//);
  }
});

test('sob HTTP (sem TLS), mantém a entrega direta por porta (comportamento histórico)', () => {
  const svc = servico({ ...PORTAS, mediaMtxPublicHost: '10.0.0.5' });
  const urls = svc.buildPublicUrls(
    req({ 'x-forwarded-proto': 'http', host: '10.0.0.5:5173' }),
    'cam_abc',
    null,
  );
  assert.equal(urls.whepUrl, 'http://10.0.0.5:8889/cam_abc/whep');
  assert.equal(urls.hlsUrl, 'http://10.0.0.5:8888/cam_abc/index.m3u8');
});

test('config explícita de URL pública vence, mesmo sob HTTPS', () => {
  const svc = servico({
    ...PORTAS,
    mediaMtxPublicWebrtcUrl: 'https://midia.exemplo.com/webrtc',
    mediaMtxPublicHlsUrl: 'https://midia.exemplo.com/hls',
  });
  const urls = svc.buildPublicUrls(
    req({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'painel.exemplo.com' }),
    'cam_abc',
    null,
  );
  assert.equal(urls.whepUrl, 'https://midia.exemplo.com/webrtc/cam_abc/whep');
  assert.equal(urls.hlsUrl, 'https://midia.exemplo.com/hls/cam_abc/index.m3u8');
});
