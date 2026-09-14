import { AlarmPriority, AlarmSource, PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const insecureSeedPasswords = new Set([
  'admin123',
  'operador123',
  'viewer123',
  '123456',
  'password',
  'changeme',
  'change_me',
]);

function assertStrongPassword(password: string, context: string) {
  if (!password || password.length < 10 || insecureSeedPasswords.has(password.toLowerCase())) {
    throw new Error(
      `${context} inválida. Defina uma senha forte via ENV (mínimo 10 caracteres, sem valores padrão).`,
    );
  }
}

function requireSeedPassword(envName: string) {
  const password = (process.env[envName] ?? '').trim();
  assertStrongPassword(password, envName);
  return password;
}

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase() || null;
  const username = (process.env.ADMIN_USERNAME ?? email ?? 'admin').trim().toLowerCase();
  const password = (process.env.ADMIN_PASSWORD ?? '').trim();
  const name = process.env.ADMIN_NAME ?? 'Administrador';
  const allowSampleUsers = String(process.env.SEED_SAMPLE_USERS ?? 'false') === 'true';

  assertStrongPassword(password, 'ADMIN_PASSWORD');

  // 1. Criar/Sincronizar Super Admin padrão
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { username },
    update: {
      name,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
    },
    create: {
      name,
      username,
      email,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
    },
  });

  // 2. Criar usuários de exemplo apenas quando explicitamente habilitado
  if (allowSampleUsers) {
    const users = [
      { name: 'Admin Local', username: 'admin.local@local.dev', email: 'admin.local@local.dev', password: requireSeedPassword('SEED_ADMIN_PASSWORD'), role: UserRole.ADMIN },
      { name: 'Operador Local', username: 'operador.local@local.dev', email: 'operador.local@local.dev', password: requireSeedPassword('SEED_OPERATOR_PASSWORD'), role: UserRole.OPERATOR },
      { name: 'Viewer Local', username: 'viewer.local@local.dev', email: 'viewer.local@local.dev', password: requireSeedPassword('SEED_VIEWER_PASSWORD'), role: UserRole.VIEWER },
    ];

    for (const item of users) {
      const found = await prisma.user.findUnique({ where: { email: item.email } });
      if (!found) {
        await prisma.user.create({
          data: {
            name: item.name,
            username: item.username,
            email: item.email,
            passwordHash: await bcrypt.hash(item.password, 10),
            role: item.role,
            isActive: true,
          },
        });
      }
    }
  }

  // 3. Criar Unidades (Sites)
  const matriz = await prisma.site.upsert({
    where: { id: 'seed-site-matriz' },
    update: { name: 'Matriz', isActive: true, location: 'Sede' },
    create: {
      id: 'seed-site-matriz',
      name: 'Matriz',
      location: 'Sede',
      description: 'Unidade principal',
      isActive: true,
    },
  });

  const galpao = await prisma.site.upsert({
    where: { id: 'seed-site-galpao' },
    update: { name: 'Galpão', isActive: true },
    create: {
      id: 'seed-site-galpao',
      name: 'Galpão',
      description: 'Unidade logística',
      isActive: true,
    },
  });

  // 4. Criar Áreas
  const areas = [
    { id: 'seed-area-portaria', siteId: matriz.id, name: 'Portaria' },
    { id: 'seed-area-estoque', siteId: galpao.id, name: 'Estoque' },
    { id: 'seed-area-adm', siteId: matriz.id, name: 'Administração' },
  ];
  for (const area of areas) {
    await prisma.area.upsert({
      where: { id: area.id },
      update: { siteId: area.siteId, name: area.name, isActive: true },
      create: { ...area, isActive: true },
    });
  }

  // 5. Criar Grupos
  const groups = [
    { id: 'seed-group-portaria', name: 'Câmeras da Portaria' },
    { id: 'seed-group-externas', name: 'Câmeras Externas' },
  ];
  for (const group of groups) {
    await prisma.cameraGroup.upsert({
      where: { id: group.id },
      update: { name: group.name, isActive: true },
      create: { ...group, isActive: true },
    });
  }

  const alarmRules = [
    {
      name: 'Falha de stream RTSP',
      source: AlarmSource.STREAM,
      eventType: 'STREAM_RTSP_START_FAILED',
      priority: AlarmPriority.P1,
      dedupWindowSeconds: 120,
    },
    {
      name: 'Falha inicial de stream',
      source: AlarmSource.STREAM,
      eventType: 'STREAM_EARLY_FAILURE',
      priority: AlarmPriority.P2,
      dedupWindowSeconds: 120,
    },
    {
      name: 'Movimento detectado',
      source: AlarmSource.MOTION,
      eventType: 'MOTION_DETECTED',
      priority: AlarmPriority.P3,
      dedupWindowSeconds: 30,
    },
    {
      name: 'Recuperação automática de saúde',
      source: AlarmSource.HEALTH,
      eventType: 'HEALTH_AUTO_RECOVERED',
      priority: AlarmPriority.P4,
      dedupWindowSeconds: 30,
      autoResolveOnRecovery: true,
    },
  ];

  for (const rule of alarmRules) {
    await prisma.alarmRule.upsert({
      where: {
        source_eventType: {
          source: rule.source,
          eventType: rule.eventType,
        },
      },
      update: rule,
      create: rule,
    });
  }
}

main()
  .catch((error) => {
    console.error('Seed failed.');
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
