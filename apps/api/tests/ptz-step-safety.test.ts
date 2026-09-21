import assert from 'node:assert/strict';
import test from 'node:test';
import { OnvifPtzService } from '../src/ptz/onvif-ptz.service';

const service = () => new OnvifPtzService(
  { decrypt: () => 'secret' } as never,
  { check: async () => true } as never,
  { getCamera: () => ({}), patchCamera: () => ({}) } as never,
);

test('PTZ por toque usa o ângulo solicitado e velocidade interna fixa', () => {
  const ptz = service();
  const preciso = ptz.buildRelativeMoveSoapBody('Right', 'Profile000', 1);
  const normal = ptz.buildRelativeMoveSoapBody('Right', 'Profile000', 3);
  const amplo = ptz.buildRelativeMoveSoapBody('Right', 'Profile000', 10);

  assert.match(preciso, /PanTilt x="0\.0056" y="0"/);
  assert.match(normal, /PanTilt x="0\.0167" y="0"/);
  assert.match(amplo, /PanTilt x="0\.0556" y="0"/);
  assert.match(normal, /<tptz:Speed>[\s\S]*PanTilt x="0\.5" y="0\.5"/);
  assert.doesNotMatch(normal, /PanTilt x="0\.2"/, 'um toque não pode voltar a equivaler a 20% do curso');
});

test('step encerra no RelativeMove aceito, sem start/stop contínuo', async () => {
  const ptz = service() as any;
  let called: Array<string> = [];
  ptz.sendPtzWithFallbacks = async (_camera: unknown, action: string) => {
    called.push(action);
    return { ok: true, message: 'ok' };
  };
  ptz.move = async () => {
    throw new Error('não deveria cair no movimento contínuo');
  };

  const result = await ptz.step({ id: 'camera-1' } as never, 'Left', 3);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'relative_move');
  assert.deepEqual(called, ['relative']);
});

test('Intelbras/Dahua não confia em RelativeMove falso-positivo e usa pulso mínimo', async () => {
  const ptz = service() as any;
  const called: string[] = [];
  ptz.sendPtzWithFallbacks = async () => {
    throw new Error('RelativeMove não deve ser usado nesse perfil');
  };
  ptz.move = async () => {
    called.push('start');
    return { ok: true, message: 'ok' };
  };
  ptz.stop = async () => {
    called.push('stop');
    return { ok: true, message: 'ok' };
  };

  const result = await ptz.step({
    id: 'camera-dahua',
    rtspPath: '/cam/realmonitor?channel=1&subtype=0',
  } as never, 'Left', 3);

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'step');
  assert.equal(result.durationMs, 50);
  assert.equal(result.angleDegrees, 3);
  assert.deepEqual(called, ['start', 'stop']);
});

test('ângulos do PTZ proprietário geram quatro pulsos realmente diferentes', async () => {
  const ptz = service() as any;
  ptz.move = async () => ({ ok: true, message: 'ok' });
  ptz.stop = async () => ({ ok: true, message: 'ok' });
  const durations: number[] = [];
  for (const angle of [2, 5, 10, 20]) {
    const result = await ptz.step({
      id: `camera-${angle}`,
      rtspPath: '/cam/realmonitor?channel=1&subtype=0',
    } as never, 'Left', angle);
    durations.push(result.durationMs);
  }
  assert.deepEqual(durations, [40, 70, 120, 220]);
});

test('Intelbras/Dahua tenta CGI antes da rota ONVIF que pode mentir sucesso', async () => {
  const ptz = service() as any;
  const called: string[] = [];
  ptz.sendProprietaryPtz = async (_camera: unknown, action: string) => {
    called.push(`cgi:${action}`);
    return { ok: true, message: 'ok', protocol: 'cgi' };
  };
  ptz.tryKnownPtzRoute = async () => {
    called.push('onvif');
    return { ok: true, message: 'ok' };
  };

  const result = await ptz.sendPtzWithFallbacks({
    id: 'camera-dahua',
    rtspPath: '/cam/realmonitor?channel=1&subtype=0',
  } as never, 'start', 'Left', 1);

  assert.equal(result.ok, true);
  assert.equal(result.protocol, 'cgi');
  assert.deepEqual(called, ['cgi:start'], 'ONVIF não pode interceptar o comando nativo');
});

test('CGI PTZ tenta primeiro a porta cadastrada sem varrer portas TCP', async () => {
  let portChecks = 0;
  const ptz = new OnvifPtzService(
    { decrypt: () => 'secret' } as never,
    { check: async () => { portChecks += 1; return true; } } as never,
    { getCamera: () => ({}), patchCamera: () => ({}) } as never,
  ) as any;
  const calls: Array<{ port: number; path: string }> = [];
  ptz.digestSoapRequest = async (input: { port: number; path: string }) => {
    calls.push({ port: input.port, path: input.path });
    return { ok: true, message: 'ok', responseBody: 'OK' };
  };

  const result = await ptz.sendProprietaryPtz({
    id: 'camera-dahua',
    ip: '100.64.0.10',
    username: 'admin',
    passwordEncrypted: 'encrypted',
    onvifPort: 8003,
    httpPort: 8002,
    channel: 1,
  } as never, 'start', 'Left');

  assert.equal(result.ok, true);
  assert.equal(portChecks, 0, 'comando não deve esperar uma varredura TCP completa');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].port, 8003);
  assert.match(calls[0].path, /action=start/);
});
