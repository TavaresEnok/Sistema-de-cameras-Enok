import test from 'node:test';
import assert from 'node:assert/strict';
import { UserRole } from '@prisma/client';
import { LiveLayoutsService } from '../src/live-layouts/live-layouts.service';
import { type AuthUser } from '../src/common/types/auth-user.type';

/**
 * O helper de compartilhamento já tem teste próprio. Estes aqui provam outra
 * coisa: que o SERVIÇO realmente chama o helper. Um filtro perfeito que ninguém
 * usa não protege ninguém.
 */

const SINDICO: AuthUser = { id: 'sindico', email: 's@x', name: 'Síndico', role: UserRole.ADMIN };
const PORTEIRO: AuthUser = { id: 'porteiro', email: 'p@x', name: 'Porteiro', role: UserRole.VIEWER };

/** Um mosaico do síndico, entregue ao porteiro, com uma câmera privada dentro. */
function cenario(opcoes: { camerasVisiveis: string[]; layouts?: unknown[] }) {
  const layouts = opcoes.layouts ?? [
    {
      id: 'm1',
      userId: SINDICO.id,
      name: 'Portaria',
      gridSize: '2x2',
      cameraIds: ['cam-portao', 'cam-privada', 'cam-garagem', ''],
      active: true,
      showOnMobile: true,
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  const prisma = {
    cameraPermission: { findMany: async () => [] },
    ronda: { findMany: async () => [] },
    liveLayout: { findMany: async () => layouts },
  };
  const accessControl = { getAccessibleCameraIds: async () => opcoes.camerasVisiveis };
  return new LiveLayoutsService(prisma as never, accessControl as never);
}

test('ENTREGAR MOSAICO NÃO ENTREGA CÂMERA: a privada some do quadro do porteiro', async () => {
  const svc = cenario({ camerasVisiveis: ['cam-portao', 'cam-garagem'] });
  const [m] = await svc.list(PORTEIRO);

  assert.deepEqual(m.cameraIds, ['cam-portao', '', 'cam-garagem', '']);
  assert.equal(m.quadrosComImagem, 2);
  assert.equal(m.origem, 'recebido');
});

test('quem recebe não edita', async () => {
  const svc = cenario({ camerasVisiveis: ['cam-portao'] });
  const [m] = await svc.list(PORTEIRO);
  assert.equal(m.podeEditar, false);
});

test('o dono edita o próprio mosaico', async () => {
  const svc = cenario({ camerasVisiveis: ['cam-portao', 'cam-privada', 'cam-garagem'] });
  const [m] = await svc.list(SINDICO);
  assert.equal(m.origem, 'meu');
  assert.equal(m.podeEditar, true);
  assert.deepEqual(m.cameraIds, ['cam-portao', 'cam-privada', 'cam-garagem', '']);
});

test('mosaico recebido sem NENHUMA câmera visível não é entregue', async () => {
  const svc = cenario({ camerasVisiveis: ['outra-coisa'] });
  assert.deepEqual(await svc.list(PORTEIRO), []);
});

test('mas o MEU mosaico não some da lista, mesmo sem câmera visível', async () => {
  // Sumir sozinho pareceria que alguém o apagou.
  const svc = cenario({ camerasVisiveis: [] });
  const meus = await svc.list(SINDICO);
  assert.equal(meus.length, 1);
  assert.equal(meus[0].quadrosComImagem, 0);
});

test('a tela de administração é recusada a quem não é administrador', async () => {
  const svc = cenario({ camerasVisiveis: [] });
  await assert.rejects(() => svc.listAdmin(PORTEIRO), /administradores/i);
});

test('operador não consegue empurrar mosaico para os colegas', async () => {
  const svc = cenario({ camerasVisiveis: [] });
  await assert.rejects(
    () => svc.create(PORTEIRO, {
      name: 'x', gridSize: '2x2', cameraIds: ['a'],
      destinatarios: { usuarios: ['sindico'] },
    }),
    /administradores/i,
  );
});
