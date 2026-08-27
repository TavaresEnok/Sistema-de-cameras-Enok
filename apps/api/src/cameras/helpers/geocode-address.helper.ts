export type GeocodedAddress = {
  displayName: string;
  latitude: number;
  longitude: number;
};

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
