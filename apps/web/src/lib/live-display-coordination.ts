export type CoordinatedDisplayId = 'main' | 'aux-1' | 'aux-2' | 'aux-3';

export type LiveDisplayPresence = {
  displayId: CoordinatedDisplayId;
  instanceId: string;
  openedAt: number;
  cameraIds: string[];
  updatedAt: number;
};

const ACTIVE_FOR_MS = 8_000;

export function findCameraDisplay(
  displays: Record<string, LiveDisplayPresence>, cameraId: string, current: CoordinatedDisplayId, now = Date.now(),
) {
  return Object.values(displays).find(item => item.displayId !== current
    && now - item.updatedAt <= ACTIVE_FOR_MS && item.cameraIds.includes(cameraId)) ?? null;
}
