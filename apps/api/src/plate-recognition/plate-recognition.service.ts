import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AccessControlService } from '../access-control/access-control.service';
import { CommercialPolicyService } from '../commercial-policy/commercial-policy.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/types/auth-user.type';

const LIST_KINDS = new Set(['ALLOW', 'BLOCK', 'WATCH']);
const DIRECTIONS = new Set(['BOTH', 'ENTERING', 'LEAVING']);

function normalizePlate(value: unknown) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function assertPlate(value: unknown) {
  const plate = normalizePlate(value);
  // Brasil antigo ABC1234 e Mercosul ABC1D23. Aceitamos ambos, nunca texto livre.
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)) {
    throw new BadRequestException('Informe uma placa brasileira válida, por exemplo ABC1D23 ou ABC1234.');
  }
  return plate;
}

@Injectable()
export class PlateRecognitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessControlService,
    private readonly policy: CommercialPolicyService,
  ) {}

  async summary(user: AuthUser) {
    const policy = await this.policy.getPolicy();
    const ids = await this.access.getAccessibleCameraIds(user);
    const enabled = await this.prisma.camera.count({ where: { plateRecognitionEnabled: true } });
    const accessibleEnabled = ids.length
      ? await this.prisma.camera.count({ where: { id: { in: ids }, plateRecognitionEnabled: true } })
      : 0;
    return {
      available: policy.restrictions.aiPlate === true,
      maxCameras: policy.maxPlateRecognitionCameras,
      enabledCameras: user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN ? enabled : accessibleEnabled,
      engine: 'not_configured',
      engineMessage: 'O reconhecimento só inicia depois de instalar e validar o motor de placas nesta instalação.',
    };
  }

  async cameras(user: AuthUser) {
    const ids = await this.access.getAccessibleCameraIds(user);
    return this.prisma.camera.findMany({
      where: { id: { in: ids }, enabled: true },
      select: {
        id: true, publicId: true, name: true, status: true, group: { select: { name: true } },
        plateRecognitionEnabled: true, plateRecognitionRoi: true, plateRecognitionDirection: true,
        plateRecognitionFps: true, plateRecognitionMinConfidence: true, plateRecognitionCooldownSeconds: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async setCamera(cameraId: string, dto: Record<string, unknown>, user: AuthUser) {
    await this.policy.assertFeature('aiPlate', user);
    const accessible = new Set(await this.access.getAccessibleCameraIds(user));
    if (!accessible.has(cameraId)) throw new ForbiddenException('Sem acesso a esta câmera.');
    const camera = await this.prisma.camera.findUnique({ where: { id: cameraId } });
    if (!camera) throw new NotFoundException('Câmera não encontrada.');
    const wantsEnabled = dto.enabled === undefined ? camera.plateRecognitionEnabled : dto.enabled === true;
    const policy = await this.policy.getPolicy();
    const direction = dto.direction === undefined ? camera.plateRecognitionDirection : String(dto.direction).toUpperCase();
    if (!DIRECTIONS.has(direction)) throw new BadRequestException('Direção inválida.');
    const integer = (key: string, current: number, min: number, max: number) => {
      if (dto[key] === undefined) return current;
      const value = Math.floor(Number(dto[key]));
      if (!Number.isFinite(value) || value < min || value > max) throw new BadRequestException(`${key} deve estar entre ${min} e ${max}.`);
      return value;
    };
    const data = {
      plateRecognitionEnabled: wantsEnabled,
      plateRecognitionDirection: direction,
      plateRecognitionFps: integer('fps', camera.plateRecognitionFps, 1, 10),
      plateRecognitionMinConfidence: integer('minConfidence', camera.plateRecognitionMinConfidence, 50, 99),
      plateRecognitionCooldownSeconds: integer('cooldownSeconds', camera.plateRecognitionCooldownSeconds, 1, 600),
      ...(dto.roi !== undefined ? { plateRecognitionRoi: dto.roi as any } : {}),
    };
    // A contagem e a ativação precisam ser uma decisão única. Sem transação,
    // dois administradores poderiam clicar ao mesmo tempo e ultrapassar o teto.
    if (wantsEnabled && !camera.plateRecognitionEnabled && policy.maxPlateRecognitionCameras !== null) {
      return this.prisma.$transaction(async (tx) => {
        const inUse = await tx.camera.count({ where: { plateRecognitionEnabled: true } });
        if (inUse >= policy.maxPlateRecognitionCameras!) {
          throw new ForbiddenException(`O limite contratado de ${policy.maxPlateRecognitionCameras} câmera(s) com leitura de placas já foi atingido.`);
        }
        return tx.camera.update({ where: { id: cameraId }, data });
      }, { isolationLevel: 'Serializable' });
    }
    return this.prisma.camera.update({ where: { id: cameraId }, data });
  }

  async listEntries(kind?: string) {
    return this.prisma.plateListEntry.findMany({ where: kind ? { kind: String(kind).toUpperCase() } : {}, orderBy: [{ kind: 'asc' }, { plateNormalized: 'asc' }] });
  }

  async createEntry(dto: Record<string, unknown>) {
    const kind = String(dto.kind ?? '').toUpperCase();
    if (!LIST_KINDS.has(kind)) throw new BadRequestException('Tipo de lista inválido.');
    const plate = assertPlate(dto.plate);
    return this.prisma.plateListEntry.create({ data: {
      plateNormalized: plate, plateDisplay: String(dto.plate).trim().toUpperCase(), kind,
      label: dto.label ? String(dto.label).slice(0, 120) : null,
      ownerName: dto.ownerName ? String(dto.ownerName).slice(0, 120) : null,
      vehicleInfo: dto.vehicleInfo ? String(dto.vehicleInfo).slice(0, 160) : null,
      active: dto.active !== false,
    }});
  }

  async deleteEntry(id: string) {
    await this.prisma.plateListEntry.delete({ where: { id } }).catch(() => { throw new NotFoundException('Placa não encontrada.'); });
    return { ok: true };
  }

  async reads(user: AuthUser, query: Record<string, unknown>) {
    const ids = await this.access.getAccessibleCameraIds(user);
    const take = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const plate = query.plate ? normalizePlate(query.plate) : '';
    return this.prisma.plateRecognition.findMany({
      where: { cameraId: { in: ids }, ...(plate ? { plateNormalized: { contains: plate } } : {}), ...(query.cameraId ? { cameraId: String(query.cameraId) } : {}) },
      include: { camera: { select: { id: true, name: true, publicId: true } } },
      orderBy: { occurredAt: 'desc' }, take,
    });
  }

  /** Fronteira interna chamada pelo worker. O worker nunca decide a lista. */
  async registerInternal(cameraId: string, dto: Record<string, unknown>) {
    const camera = await this.prisma.camera.findUnique({ where: { id: cameraId } });
    if (!camera || !camera.plateRecognitionEnabled) throw new NotFoundException('Leitura de placas não está ativa nesta câmera.');
    const policy = await this.policy.getPolicy();
    if (policy.restrictions.aiPlate !== true) throw new ForbiddenException('Leitura de placas bloqueada pela Central.');
    const plate = assertPlate(dto.plate);
    const confidence = Number(dto.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new BadRequestException('Confiança inválida.');
    if (confidence * 100 < camera.plateRecognitionMinConfidence) return { accepted: false, reason: 'below_camera_threshold' };
    const match = await this.prisma.plateListEntry.findFirst({ where: { plateNormalized: plate, active: true, OR: [{ validFrom: null }, { validFrom: { lte: new Date() } }], AND: [{ OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }] }] } });
    const occurredAt = dto.occurredAt ? new Date(String(dto.occurredAt)) : new Date();
    const read = await this.prisma.plateRecognition.create({ data: { cameraId, plateRaw: String(dto.plate).slice(0, 24), plateNormalized: plate, confidence, direction: dto.direction ? String(dto.direction).toUpperCase() : null, listKind: match?.kind ?? null, snapshotPath: dto.snapshotPath ? String(dto.snapshotPath).slice(0, 500) : null, metadata: dto.metadata as any, occurredAt } });
    return { accepted: true, readId: read.id, listKind: match?.kind ?? null };
  }
}
