'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const FORMAT = 'drac-reactivation-archive-v1';
const DEFAULT_RETENTION_MONTHS = 24;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

function safeId(value) {
  const id = String(value || '').trim();
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(id)) throw new Error('Identificador de instalação inválido.');
  return id;
}

function archiveKey(secret) {
  const value = String(secret || '').trim();
  if (value.length < 32) throw new Error('DRAC_CENTRAL_ARCHIVE_KEY deve ter ao menos 32 caracteres.');
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function expiresAfterMonths(from = new Date(), months = DEFAULT_RETENTION_MONTHS) {
  const date = new Date(from);
  date.setUTCMonth(date.getUTCMonth() + Math.max(1, Number(months) || DEFAULT_RETENTION_MONTHS));
  return date.toISOString();
}

function sanitizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Snapshot de reativação inválido.');
  const allowed = [
    'version', 'createdAt', 'installation', 'sites', 'siteMapLayouts', 'areas',
    'groups', 'users', 'cameras', 'cameraPermissions', 'liveLayouts',
    'aiSettings', 'rolePermissions', 'systemSettings',
  ];
  const clean = {};
  for (const key of allowed) {
    if (snapshot[key] !== undefined) clean[key] = snapshot[key];
  }
  const text = JSON.stringify(clean);
  if (Buffer.byteLength(text) > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot de reativação excede 8 MiB.');
  if (/(passwordHash|passwordEncrypted|secretAccessKey|tokenHash|rtmpIngestKey|pushToken)/i.test(text)) {
    throw new Error('Snapshot contém credencial ou sessão proibida.');
  }
  return JSON.parse(text);
}

class ReactivationArchiveStore {
  constructor({ directory, secret, now = () => new Date() }) {
    this.directory = path.resolve(directory);
    this.key = archiveKey(secret);
    this.now = now;
  }

  fileFor(installationId) {
    return path.join(this.directory, `${safeId(installationId)}.archive`);
  }

  async write(installationId, requestId, snapshot, expiresAt) {
    const clean = sanitizeSnapshot(snapshot);
    const plaintext = Buffer.from(JSON.stringify({ format: FORMAT, installationId, requestId, snapshot: clean }), 'utf8');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope = Buffer.from(JSON.stringify({
      format: FORMAT,
      algorithm: 'AES-256-GCM',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: encrypted.toString('base64'),
    }), 'utf8');
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.fileFor(installationId);
    const temp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(temp, envelope, { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, target);
    await fs.chmod(target, 0o600);
    return {
      state: 'AVAILABLE',
      requestId: String(requestId),
      createdAt: this.now().toISOString(),
      expiresAt: String(expiresAt),
      sizeBytes: envelope.length,
      sha256: crypto.createHash('sha256').update(envelope).digest('hex'),
      format: FORMAT,
    };
  }

  async read(installationId) {
    const envelope = JSON.parse(await fs.readFile(this.fileFor(installationId), 'utf8'));
    if (envelope.format !== FORMAT || envelope.algorithm !== 'AES-256-GCM') throw new Error('Formato de arquivo de reativação incompatível.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
    const payload = JSON.parse(plaintext.toString('utf8'));
    if (payload.format !== FORMAT) throw new Error('Conteúdo de arquivo de reativação incompatível.');
    return payload;
  }

  async delete(installationId) {
    await fs.rm(this.fileFor(installationId), { force: true });
  }
}

module.exports = {
  DEFAULT_RETENTION_MONTHS,
  FORMAT,
  ReactivationArchiveStore,
  expiresAfterMonths,
  sanitizeSnapshot,
};
