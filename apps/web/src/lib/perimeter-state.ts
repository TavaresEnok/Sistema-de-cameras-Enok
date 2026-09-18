export type PerimeterProcessor = {
  running?: boolean;
  last_seen?: number;
  readiness?: { ready?: boolean; frame_age_seconds?: number | null };
  inference?: { status?: string };
  motion_detector?: { perimeter_ignored_motion?: { zone: string; at: number } | null };
};

export function perimeterState(online: boolean, hasLines: boolean, processor: PerimeterProcessor | undefined, checked: boolean, now = Date.now()) {
  if (!online) return { label: 'Câmera desconectada', attention: true };
  if (!checked) return { label: 'Verificando análise', attention: false };
  if (!processor) return { label: 'Aguardando ativação da análise', attention: true };
  const recent = typeof processor.last_seen === 'number' && now / 1000 - processor.last_seen <= 20;
  if (!processor.running || !recent || processor.readiness?.ready === false) return { label: 'Análise interrompida', attention: true };
  if (hasLines && processor.inference?.status !== 'ok') return { label: 'Travessia sem análise confirmada', attention: true };
  return { label: 'Monitorando', attention: false };
}

// ab = lado negativo → positivo, igual ao avaliador de travessia da API.
export function crossingArrow(points: number[][]) {
  if (points.length !== 2) return null;
  const [[ax, ay], [bx, by]] = points;
  const length = Math.hypot(bx - ax, by - ay);
  if (length < 0.000001) return null;
  const x = (ax + bx) * 50, y = (ay + by) * 50;
  const nx = -(by - ay) / length * 6, ny = (bx - ax) / length * 6;
  return { x1: x - nx, y1: y - ny, x2: x + nx, y2: y + ny };
}
