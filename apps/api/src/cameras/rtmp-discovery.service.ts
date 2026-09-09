import { BadRequestException, ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { PrismaService } from '../common/prisma/prisma.service';
import { PendingIngestRegistry } from './pending-ingest.registry';
import { CamerasService } from './cameras.service';
import { hashIngestKey, ingestKeyFromPathName, ingestProfilePathCandidates, isAcceptableIngestPath, normalizeIngestPath } from './helpers/rtmp-ingest.helper';

const LEASE = 'rtmp.discovery.preview';
const IGNORE = 'rtmp.discovery.ignore.';
type Lease = { id: string; path: string; userId: string; until: number; remoteAddr: string | null };

@Injectable()
export class RtmpDiscoveryService implements OnModuleInit, OnModuleDestroy {
  private lease: Lease | null = null;
  private busy = false;
  private capturing = false;
  private timer?: ReturnType<typeof setInterval>;
  private capture?: ReturnType<typeof spawn>;
  private readonly logger = new Logger(RtmpDiscoveryService.name);
  private cleanupFailed = false;
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService,
    private readonly pending: PendingIngestRegistry, private readonly cameras: CamerasService) {}

  async onModuleInit() {
    const saved = await this.prisma.systemSetting.findUnique({ where: { key: LEASE } });
    if (saved) { this.lease = JSON.parse(saved.value); this.lease!.until = 0; }
    this.timer = setInterval(() => { void this.expire().catch(() => {
      if (!this.cleanupFailed) this.logger.error('Falha ao encerrar prévia RTMP; autorização revogada, novas prévias bloqueadas. Repetindo encerramento.');
      this.cleanupFailed = true;
    }); }, 3000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); this.capture?.kill('SIGKILL'); }
  private key(path: string) { return IGNORE + createHash('sha256').update(path).digest('hex'); }
  private path(value: unknown) {
    if (!isAcceptableIngestPath(value)) throw new BadRequestException('Equipamento inválido.');
    return normalizeIngestPath(value as string);
  }
  async known(path: string) {
    const key = ingestKeyFromPathName(path);
    // Ownership includes disabled/private cameras: discovery must never bypass their ACL.
    return this.prisma.camera.findFirst({ where: { OR: [
      { rtmpIngestPath: { in: ingestProfilePathCandidates(path) } },
      ...(key ? [{ rtmpIngestKeyHash: hashIngestKey(key) }] : []),
    ] }, select: { id: true } });
  }
  allows(path: string, remoteAddr?: string | null) {
    return !!this.lease && this.lease.until > Date.now() && this.lease.path === path
      && (!remoteAddr || !this.lease.remoteAddr || remoteAddr === this.lease.remoteAddr);
  }
  async list() {
    const ignoredRows = await this.prisma.systemSetting.findMany({ where: { key: { startsWith: IGNORE } } });
    const ignored = ignoredRows.map(row => JSON.parse(row.value));
    const hidden = new Set(ignored.map(row => row.path));
    const items = [];
    for (const item of this.pending.list()) {
      if (!hidden.has(item.path) && !await this.known(item.path)) items.push(item);
    }
    return { items, ignored };
  }
  async ignore(value: unknown, userId: string, undo = false) {
    const path = this.path(value);
    if (undo) await this.prisma.systemSetting.deleteMany({ where: { key: this.key(path) } });
    else {
      if (await this.prisma.systemSetting.count({ where: { key: { startsWith: IGNORE } } }) >= 1000)
        throw new ConflictException('A lista de ignoradas está cheia. Remova entradas antigas.');
      if (this.lease?.path === path) { this.lease.until = 0; await this.expire(); }
      await this.prisma.systemSetting.upsert({ where: { key: this.key(path) },
        create: { key: this.key(path), value: JSON.stringify({ path, ignoredAt: Date.now() }), updatedByUserId: userId },
        update: { value: JSON.stringify({ path, ignoredAt: Date.now() }), updatedByUserId: userId } });
    }
    return { ok: true };
  }
  private async srs(route: string, method = 'GET') {
    const token = this.config.get<string>('mediaMtxAuthCallbackToken') || '';
    if (token.length < 32) throw new ServiceUnavailableException('Prévia indisponível: autenticação interna não configurada.');
    const r = await fetch('http://rtmp-callback:8080/discovery-srs/' + route, {
      method, headers: { 'X-Discovery-Token': token },
      signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new ServiceUnavailableException('Prévia temporariamente indisponível.');
    const body = await r.json();
    if (body.code !== 0) throw new ServiceUnavailableException('Não foi possível controlar a prévia.');
    return body;
  }
  private async expire() {
    if (!this.lease || this.lease.until > Date.now() || this.busy) return;
    this.busy = true;
    try {
      const path = this.lease.path;
      if (!await this.cameras.findCameraByIngestPath(path)) {
        const list = await this.srs('clients/?start=0&count=10000');
        for (const client of list.clients || []) {
          const candidate = String(client.url || '').replace(/^\//, '').split('?')[0];
          if (candidate === path || candidate === '__defaultVhost__/' + path)
            await this.srs('clients/' + encodeURIComponent(client.id), 'DELETE');
        }
      }
      await this.prisma.systemSetting.deleteMany({ where: { key: LEASE } });
      this.lease = null;
      this.cleanupFailed = false;
    } finally { this.busy = false; }
  }
  async start(value: unknown, userId: string) {
    const path = this.path(value);
    await this.expire();
    if (this.busy || this.lease) throw new ConflictException('Já existe uma prévia em andamento. Aguarde seu encerramento.');
    this.busy = true;
    try {
      const item = this.pending.list().find(row => row.path === path);
      if (!item || await this.known(path)) throw new BadRequestException('Esse equipamento não está mais pendente.');
      if (await this.prisma.systemSetting.findUnique({ where: { key: this.key(path) } }))
        throw new BadRequestException('Restaure o equipamento ignorado antes de abrir a prévia.');
      await this.srs('clients/?start=0&count=1'); // Never accept media without a working cleanup channel.
      if (!item.remoteAddr) throw new BadRequestException('Aguarde uma nova tentativa do equipamento antes de abrir a prévia.');
      const lease = { id: randomUUID(), path, userId, remoteAddr: item.remoteAddr, until: Date.now() + 90000 };
      await this.prisma.systemSetting.create({ data: { key: LEASE, value: JSON.stringify(lease), updatedByUserId: userId } });
      this.lease = lease;
      return { id: lease.id, expiresAt: lease.until };
    } finally { this.busy = false; }
  }
  async stop(userId: string, id?: string) {
    if (this.lease && this.lease.userId === userId && this.lease.id === id) {
      this.lease.until = 0;
      this.capture?.kill('SIGKILL');
      await this.expire();
    }
    return { ok: true };
  }
  async frame(userId: string, id?: string): Promise<Buffer | null> {
    const lease = this.lease;
    if (!lease || lease.userId !== userId || lease.id !== id || !this.allows(lease.path))
      throw new BadRequestException('Prévia encerrada. Clique em Espiar novamente.');
    if (this.capturing) return null;
    this.capturing = true;
    try {
      const url = new URL(this.config.get<string>('mediaMtxRtspInternalUrl') || 'rtsp://mediamtx:8554');
      url.username = this.config.get<string>('mediaMtxApiUser') || '';
      url.password = this.config.get<string>('mediaMtxApiPass') || '';
      url.pathname = '/' + lease.path;
      return await new Promise<Buffer | null>(resolve => {
        const child = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-threads', '1', '-rtsp_transport', 'tcp',
          '-i', url.toString(), '-an', '-frames:v', '1', '-vf', 'scale=640:360:force_original_aspect_ratio=decrease',
          '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
        this.capture = child;
        const chunks: Buffer[] = []; let bytes = 0;
        const timer = setTimeout(() => child.kill('SIGKILL'), 6000);
        child.stdout!.on('data', (data: Buffer) => { bytes += data.length; if (bytes > 2_000_000) child.kill('SIGKILL'); else chunks.push(data); });
        child.on('error', () => { clearTimeout(timer); resolve(null); });
        child.on('close', code => { clearTimeout(timer); this.capture = undefined;
          resolve(code === 0 && bytes > 0 && this.allows(lease.path) ? Buffer.concat(chunks) : null); });
      });
    } finally { this.capturing = false; }
  }
}
