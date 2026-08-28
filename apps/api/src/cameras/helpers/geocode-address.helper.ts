export type GeocodedAddress = {
  displayName: string;
  latitude: number;
  longitude: number;
};

export function isPublicIpForGeolocation(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

export function parseIpGeocodeResult(payload: unknown): GeocodedAddress | null {
  if (!payload || typeof payload !== 'object') return null;
  const item = payload as Record<string, unknown>;
  if (item.success !== true) return null;
  const latitude = Number(item.latitude);
  const longitude = Number(item.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  const parts = [item.city, item.region, item.country]
    .filter((value) => typeof value === 'string' && value.trim())
    .map(String);
  return { displayName: parts.join(', ') || 'posição estimada pela rede', latitude, longitude };
}

/**
 * Converte a resposta do geocodificador em um contrato pequeno e validado.
 * A API externa nunca decide diretamente o que será persistido.
 */
export function parseGeocodeResult(payload: unknown): GeocodedAddress | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const first = payload[0] as Record<string, unknown>;
  const latitude = Number(first.lat);
  const longitude = Number(first.lon);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  const displayName = typeof first.display_name === 'string' ? first.display_name.trim() : '';
  return { displayName, latitude, longitude };
}
