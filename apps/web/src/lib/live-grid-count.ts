type VisibleCamera = { id: string; isOnline: boolean } | null;

/** Conta só câmeras renderizadas nesta grade, nunca slots vazios ou a frota inteira. */
export function countVisibleGridCameras(cameras: VisibleCamera[], focusedCameraId: string | null) {
  const visible = cameras.filter((camera): camera is NonNullable<VisibleCamera> =>
    camera !== null && (!focusedCameraId || camera.id === focusedCameraId));
  return { online: visible.filter((camera) => camera.isOnline).length, total: visible.length };
}
