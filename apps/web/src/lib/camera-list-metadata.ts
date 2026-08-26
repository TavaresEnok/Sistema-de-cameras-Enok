export type CameraSourceMode = 'rtsp_pull' | 'rtmp_push';

/** Rótulo curto para a chave operacional; o UUID continua sendo a chave interna. */
export function cameraPublicIdLabel(publicId?: number | null, internalId = ''): string {
  const numeric = Number(publicId);
  if (Number.isSafeInteger(numeric) && numeric > 0) return String(numeric);
  const legacy = internalId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  return legacy || '—';
}

export function cameraSourceProtocol(sourceMode?: string | null): 'RTSP' | 'RTMP' {
  return sourceMode === 'rtmp_push' ? 'RTMP' : 'RTSP';
}

export function formatStorageBytes(value?: number | null): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / (1024 ** unit);
  const digits = amount >= 100 || unit === 0 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits).replace('.', ',')} ${units[unit]}`;
}
