import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordingProcessManagerService } from '../src/recordings/recording-process-manager.service';

// ── ARMAR NÃO É "VOLTAR PARA MOVIMENTO" ─────────────────────────────────────
//
// `setMotionRecording(enabled=true)` atende ao botão de armar da lista de
// câmeras, e escrevia `recordingMode: 'motion'` sem olhar o modo atual.
//
// Numa câmera configurada em `object` — "só pessoa, não carro" — bastava o
// operador tocar nesse botão para a escolha inteira ser apagada EM SILÊNCIO:
// nenhum aviso, nenhum erro, e a tela reabre mostrando "Movimento". O sintoma
// que chega é sempre o mesmo, e não parece um bug de gravação: "a opção não
// salva", "isso só funcionou naquela câmera".
//
// Quem decide o modo é quem configurou a câmera. Este atalho só ARMA.

function montar(camera: { id?: string; recordingMode?: string } | null) {
  const gravado: Array<Record<string, unknown>> = [];
  const svc: any = Object.create(RecordingProcessManagerService.prototype);

  svc.logger = { warn: () => {}, log: () => {}, error: () => {} };
  svc.camerasService = {
    getCameraOrThrow: async () => {
      if (!camera) throw new Error('não existe');
      return { id: 'cam-1', recordingMode: 'motion', ...camera };
    },
  };
  svc.prisma = {
    camera: {
      update: async ({ data }: any) => {
        gravado.push(data);
        return data;
      },
    },
  };
  svc.clearMotionStopTimer = () => {};
  svc.stop = async () => ({ status: 'stopped' });
  svc.startPreBuffer = async () => undefined;
  svc.stopPreBuffer = async () => undefined;

  return { svc, gravado };
}

test('armar uma câmera em modo objeto PRESERVA o modo objeto', async () => {
  const { svc, gravado } = montar({ recordingMode: 'object' });
  const resultado = await svc.setMotionRecording('cam-1', true);

  assert.equal(
    gravado[0].recordingMode,
    'object',
    'o botão de armar apagou a configuração de "só pessoa" da câmera',
  );
  assert.equal(resultado.recordingMode, 'object', 'a resposta precisa dizer o modo real, senão o aviso na tela mente');
});

test('armar uma câmera em modo movimento continua em movimento', async () => {
  const { svc, gravado } = montar({ recordingMode: 'motion' });
  await svc.setMotionRecording('cam-1', true);
  assert.equal(gravado[0].recordingMode, 'motion');
});

test('armar uma câmera NÃO armada usa movimento (o comportamento histórico)', async () => {
  // Manual e contínua não têm modo armado próprio; o botão define movimento,
  // que é o que ele sempre fez e o que o operador espera.
  for (const modo of ['manual', 'continuous', 'schedule', null, undefined]) {
    const { svc, gravado } = montar({ recordingMode: modo as any });
    await svc.setMotionRecording('cam-1', true);
    assert.equal(gravado[0].recordingMode, 'motion', `partindo de ${modo}`);
  }
});

test('desarmar leva a manual venha de onde vier', async () => {
  // Inclusive do modo objeto: desarmar é uma ordem explícita do operador,
  // diferente de armar, que é só ligar o que já estava configurado.
  for (const modo of ['object', 'motion']) {
    const { svc, gravado } = montar({ recordingMode: modo });
    await svc.setMotionRecording('cam-1', false);
    assert.equal(gravado[0].recordingMode, 'manual', `partindo de ${modo}`);
    assert.equal(gravado[0].recordingEnabled, false);
  }
});

test('armar nunca deixa recordingEnabled ligado (o evento é que grava)', async () => {
  const { svc, gravado } = montar({ recordingMode: 'object' });
  await svc.setMotionRecording('cam-1', true);
  assert.equal(
    gravado[0].recordingEnabled,
    false,
    'ligar aqui faria a câmera gravar 24h achando estar armada',
  );
});
