import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { temZonaDeArea } from '../src/cameras/helpers/validar-zonas.helper';

// ── ZONA DE ÁREA EXIGE O NOSSO DETECTOR ─────────────────────────────────────
// Bug real (11/08/2026): o dono desenhou "Monitorar só aqui" na Cam-09 e seguiu
// recebendo gravação de movimento FORA do perímetro. A zona estava salva certa
// e o MOG2 respeita a máscara (provado em teste no container) — mas o gatilho
// era `motionTrigger='CAMERA'`: o evento ONVIF do fabricante dispara para
// movimento em QUALQUER ponto da cena e não carrega coordenadas. É fisicamente
// incapaz de respeitar zonas. O pulo de detecção nativa já tinha sido corrigido
// para a LINHA; faltava a ÁREA.

test('predicado: área conta, linha sozinha não', () => {
  assert.equal(temZonaDeArea([{ kind: 'include' }]), true);
  assert.equal(temZonaDeArea([{ kind: 'exclude' }]), true);
  assert.equal(temZonaDeArea([{ kind: 'line' }]), false, 'linha tem caminho próprio (tripwire)');
  assert.equal(temZonaDeArea([]), false);
  assert.equal(temZonaDeArea(undefined), false);
  assert.equal(temZonaDeArea(null), false);
});

test('salvar zona de área em câmera CAMERA+motion migra o gatilho e ARMA a análise', () => {
  const src = readFileSync('src/cameras/cameras.service.ts', 'utf8');
  const i = src.indexOf('migrarGatilhoParaZonas');
  assert.ok(i > 0, 'a migração de gatilho precisa existir no update da câmera');
  const decisao = src.slice(i, i + 400);
  assert.match(decisao, /temZonaDeArea\(dto\.detectionZones\)/);
  assert.match(decisao, /'motion'/);
  assert.match(decisao, /'CAMERA'/);
  // O efeito: motionTrigger vira SYSTEM e aiEnabled liga (sem isso o
  // startCamera devolve 'camera_disabled' e a máscara nunca entra em cena).
  assert.match(src, /migrarGatilhoParaZonas \? 'SYSTEM'/);
  assert.match(src, /migrarGatilhoParaZonas \? \{ aiEnabled: true \}/);
});

test('a sonda ONVIF NÃO devolve a câmera para CAMERA enquanto houver zona de área', () => {
  // Sem esta trava, o auto-probe (a cada 15 min) "promovia" a câmera de volta
  // ao gatilho nativo e desfazia a migração em silêncio — o perímetro do
  // operador virava enfeite minutos depois de configurado.
  const src = readFileSync('src/cameras/onvif-events.service.ts', 'utf8');
  assert.match(src, /supports && !temZonaDeArea\(cam\.detectionZones\) \? 'CAMERA' : 'SYSTEM'/);
  assert.match(src, /detectionZones: true/, 'a sonda precisa LER as zonas para decidir');
});
