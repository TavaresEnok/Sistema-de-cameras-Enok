export type LocalizacaoDoInstalador = {
  latitude: number;
  longitude: number;
  locationAddress: string;
};

type GeolocationLike = Pick<Geolocation, 'getCurrentPosition'>;

/** Converte o GPS autorizado no metadado persistido da câmera. */
export function payloadDaLocalizacaoDoInstalador(position: GeolocationPosition): LocalizacaoDoInstalador | null {
  const latitude = Number(position.coords.latitude);
  const longitude = Number(position.coords.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  const accuracy = Number(position.coords.accuracy);
  const precision = Number.isFinite(accuracy) && accuracy > 0
    ? ` · precisão aproximada de ${Math.max(1, Math.round(accuracy))} m`
    : '';
  return {
    latitude,
    longitude,
    locationAddress: `GPS do dispositivo usado no cadastro${precision}`,
  };
}

/**
 * Negar permissão, usar HTTP ou estar num computador sem localização não
 * bloqueia o cadastro: o servidor conserva o GeoIP como fallback.
 */
export function capturarLocalizacaoDoInstalador(
  geolocation: GeolocationLike | null | undefined = typeof navigator === 'undefined' ? null : navigator.geolocation,
): Promise<LocalizacaoDoInstalador | null> {
  if (!geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (position) => resolve(payloadDaLocalizacaoDoInstalador(position)),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  });
}
