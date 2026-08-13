import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RetentionService } from '../src/recordings/retention.service';

// EXCLUSÃO MANUAL a partir da tela de Reprodução (botão "Apagar N gravações").
//
// O risco aqui é assimétrico e os testes refletem isso: gravar demais custa
// disco, apagar prova custa o incidente. Por isso a maior parte destes testes
// verifica o que NÃO pode ser apagado.

type Linha = {
  id: string;
  cameraId: string;
  filePath: string;
  sizeBytes: bigint | null;
  endedAt: Date | null;
};

function semear(root: string, nome: string) {
  const cam = join(root, 'camera-cam-1');
  mkdirSync(cam, { recursive: true });
  const mp4 = join(cam, `${nome}.mp4`);
  const thumb = join(cam, `${nome}.thumb.jpg`);
  for (const f of [mp4, thumb]) writeFileSync(f, 'x');
  return { mp4, thumb, relative: join('camera-cam-1', `${nome}.mp4`) };
}

function fazerServico(root: string, linhas: Linha[], protegidas: string[] = []) {
  const svc: any = Object.create(RetentionService.prototype);
  svc.logger = { warn() {}, log() {} };
  svc.config = { get: (k: string) => (k === 'recordingsRoot' ? root : undefined) };
  svc.prisma = {
    exportedClip: { findMany: async () => [], delete: async () => ({}) },
    recording: {
      findMany: async ({ where }: any) => {
        const pedidos: string[] = where?.id?.in ?? [];
        return linhas.filter((l) => pedidos.includes(l.id)).map((l) => ({ ...l, cloudKey: null, cloudStorageId: null }));
      },
      delete: async () => ({}),
    },
    $transaction: async (callback: (tx: any) => unknown) => callback({
      $executeRawUnsafe: async () => 1,
      exportedClip: { delete: async () => ({}), deleteMany: async () => ({ count: 0 }) },
      recording: { delete: async () => ({}) },
    }),
  };
  // A nuvem não participa deste teste; o que importa aqui é disco + contagem.
  svc.deleteCloudObject = async () => undefined;
  svc.getProtectionSets = async () => ({
    recordingIds: new Set(protegidas),
    clipIds: new Set<string>(),
    eventIds: new Set<string>(),
  });
  return svc;
}

const fechada = (id: string, arquivo: string, bytes = 1000): Linha => ({
  id, cameraId: 'cam-1', filePath: arquivo, sizeBytes: BigInt(bytes), endedAt: new Date('2026-08-13T10:00:00Z'),
});

test('apaga só as gravações escolhidas, com miniatura, e não toca nas outras', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drac-del-'));
  try {
    const a = semear(root, 'a');
    const b = semear(root, 'b');
    const svc = fazerServico(root, [fechada('r-a', a.relative), fechada('r-b', b.relative)]);

    const res = await svc.excluirGravacoesEscolhidas(['r-a']);

    assert.equal(res.excluidas, 1);
    assert.equal(existsSync(a.mp4), false, 'a escolhida deveria sumir');
    assert.equal(existsSync(a.thumb), false, 'a miniatura da escolhida deveria sumir junto');
    assert.equal(existsSync(b.mp4), true, 'apagou uma gravação que ninguém pediu');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('NÃO apaga gravação sob retenção legal ou anexada a investigação', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drac-del-'));
  try {
    const prova = semear(root, 'prova');
    const comum = semear(root, 'comum');
    const svc = fazerServico(
      root,
      [fechada('r-prova', prova.relative), fechada('r-comum', comum.relative)],
      ['r-prova'],
    );

    const res = await svc.excluirGravacoesEscolhidas(['r-prova', 'r-comum']);

    assert.equal(existsSync(prova.mp4), true, 'apagou PROVA sob proteção — o pior defeito possível aqui');
    assert.equal(res.protegidas, 1);
    assert.equal(res.excluidas, 1, 'a proteção de uma não pode bloquear a exclusão da outra');
    assert.equal(existsSync(comum.mp4), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('NÃO apaga gravação em andamento (FFmpeg ainda escrevendo no arquivo)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drac-del-'));
  try {
    const viva = semear(root, 'viva');
    const svc = fazerServico(root, [
      { id: 'r-viva', cameraId: 'cam-1', filePath: viva.relative, sizeBytes: BigInt(10), endedAt: null },
    ]);

    const res = await svc.excluirGravacoesEscolhidas(['r-viva']);

    assert.equal(res.emAndamento, 1);
    assert.equal(res.excluidas, 0);
    assert.equal(existsSync(viva.mp4), true, 'apagar debaixo do FFmpeg deixa o processo gravando em inode órfão');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('id inexistente vira contagem, não erro — a lista da tela pode estar velha', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drac-del-'));
  try {
    const a = semear(root, 'a');
    const svc = fazerServico(root, [fechada('r-a', a.relative)]);

    const res = await svc.excluirGravacoesEscolhidas(['r-a', 'r-que-nao-existe']);

    assert.equal(res.excluidas, 1);
    assert.equal(res.naoEncontradas, 1);
    assert.equal(res.solicitadas, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ids repetidos contam uma vez só', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drac-del-'));
  try {
    const a = semear(root, 'a');
    const svc = fazerServico(root, [fechada('r-a', a.relative)]);

    const res = await svc.excluirGravacoesEscolhidas(['r-a', 'r-a', 'r-a']);

    assert.equal(res.solicitadas, 1);
    assert.equal(res.excluidas, 1);
    assert.equal(res.naoEncontradas, 0, 'deduplicar mal faria a mesma gravação virar "não encontrada"');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('soma os bytes liberados só do que realmente saiu', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drac-del-'));
  try {
    const a = semear(root, 'a');
    const b = semear(root, 'b');
    const svc = fazerServico(
      root,
      [fechada('r-a', a.relative, 3000), fechada('r-b', b.relative, 500)],
      ['r-b'], // protegida: os bytes dela NÃO podem entrar na conta
    );

    const res = await svc.excluirGravacoesEscolhidas(['r-a', 'r-b']);

    assert.equal(res.bytesLiberados, '3000');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lista vazia de resultado não quebra a contagem', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drac-del-'));
  try {
    const svc = fazerServico(root, []);
    const res = await svc.excluirGravacoesEscolhidas(['sumiu']);
    assert.deepEqual(
      { ...res },
      { solicitadas: 1, excluidas: 0, protegidas: 0, emAndamento: 0, naoEncontradas: 1, bytesLiberados: '0' },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
