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
