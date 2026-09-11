type CameraControlPorts = {
  onvifPort?: number | null;
  httpPort?: number | null;
};

const validPort = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535;

/**
 * Porta ONVIF explícita sempre vence. Sem ela, a porta web é a primeira
 * candidata: vários fabricantes servem painel e ONVIF no mesmo listener.
 */
export function preferredCameraControlPort(camera: CameraControlPorts): number | null {
  if (validPort(camera.onvifPort)) return camera.onvifPort;
  if (validPort(camera.httpPort)) return camera.httpPort;
  return null;
}

export function cameraControlPortCandidates(
  camera: CameraControlPorts,
  fallbacks: Array<number | null | undefined> = [],
): number[] {
  return Array.from(new Set([
    camera.onvifPort,
    camera.httpPort,
    ...fallbacks,
  ].filter(validPort)));
}
