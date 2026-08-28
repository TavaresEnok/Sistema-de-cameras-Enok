import * as Location from 'expo-location';
import { buildInstallerLocationPayload, type InstallerLocationPayload } from './installer-location-core';

/**
 * O sistema operacional mostra o consentimento. Qualquer indisponibilidade
 * devolve null para que o cadastro prossiga e o servidor aplique GeoIP.
 */
export async function captureInstallerLocation(): Promise<InstallerLocationPayload | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) return null;
    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return buildInstallerLocationPayload(
      current.coords.latitude,
      current.coords.longitude,
      current.coords.accuracy,
    );
  } catch {
    return null;
  }
}
