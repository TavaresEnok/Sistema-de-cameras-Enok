import assert from 'node:assert/strict';
import test from 'node:test';
import { OnvifPtzService } from '../src/ptz/onvif-ptz.service';

const service = () => new OnvifPtzService(
  { decrypt: () => 'secret' } as never,
  { check: async () => true } as never,
  { getCamera: () => ({}) } as never,
);

test('PTZ por toque usa deslocamento relativo pequeno, proporcional à velocidade', () => {
  const ptz = service();
  const lento = ptz.buildRelativeMoveSoapBody('Right', 'Profile000', 1);
  const normal = ptz.buildRelativeMoveSoapBody('Right', 'Profile000', 5);
  const rapido = ptz.buildRelativeMoveSoapBody('Right', 'Profile000', 10);

  assert.match(lento, /PanTilt x="0\.005" y="0"/);
  assert.match(normal, /PanTilt x="0\.009" y="0"/);
  assert.match(rapido, /PanTilt x="0\.014" y="0"/);
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

  const result = await ptz.step({ id: 'camera-1' } as never, 'Left', 5, 160);
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
  } as never, 'Left', 1, 160);

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'step');
  assert.equal(result.durationMs, 80);
  assert.deepEqual(called, ['start', 'stop']);
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
    { getCamera: () => ({}) } as never,
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
