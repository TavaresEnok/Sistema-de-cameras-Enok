export type InstallerLocationPayload = {
  latitude: number;
  longitude: number;
  locationAddress: string;
};

export function buildInstallerLocationPayload(
  latitudeValue: unknown,
  longitudeValue: unknown,
  accuracyValue?: unknown,
): InstallerLocationPayload | null {
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  const accuracy = Number(accuracyValue);
  const precision = Number.isFinite(accuracy) && accuracy > 0
    ? ` · precisão aproximada de ${Math.max(1, Math.round(accuracy))} m`
    : '';
  return {
    latitude,
    longitude,
    locationAddress: `GPS do dispositivo usado no cadastro${precision}`,
  };
}
