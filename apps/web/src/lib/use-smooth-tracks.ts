/**
 * useSmoothTracks — identidade estável por trackId + interpolação entre amostras.
 *
 * O problema que este hook mata: o `id` de cada detecção vem do backend como
 * `${cameraId}-${timestampMs}-${idx}` — muda a CADA amostra. Com `key={id}`,
 * o React destrói e recria o elemento da caixa a cada atualização (remount),
 * então a caixa "pisca" e transições CSS nunca rodam (transição não anima em
 * mount). Este hook:
 *
 *   1. Usa `trackId` como identidade quando existir (`track-${trackId}`), com
 *      fallback para `detection.id` (faces e detecções sem tracking).
 *      NUNCA `trackId || id` — trackId 0 é válido e `||` o descartaria.
 *   2. Mantém, por identidade, a caixa ANTERIOR e a caixa ALVO, e interpola
 *      entre elas em requestAnimationFrame. Nova amostra não cria elemento:
 *      só muda o destino da caixa existente (100 → 107 → … → 140).
 *   3. Segura a caixa por um TTL curto quando uma amostra falta (holdMs),
 *      evitando o pisca de "sumiu por 1 ciclo". Fallbacks (sem trackId) não
 *      ganham TTL: são substituídos em bloco, como hoje.
 *
 * A cadência das amostras é estimada por identidade (tempo entre alvos) e
 * limitada a [120ms, 900ms] — polling de 500ms vira uma animação de ~500ms.
 */
import { useEffect, useRef, useState } from 'react';
import type { LiveDetection } from './live-detections-poller';

export type SmoothDetection = LiveDetection & {
  renderKey: string;
  /** true enquanto a caixa vive apenas do TTL (sem amostra fresca) */
  coasting: boolean;
};

type TrackState = {
  meta: LiveDetection;
  from: [number, number, number, number];
  target: [number, number, number, number];
  targetSetAt: number;
  intervalMs: number;
  lastSeen: number;
  isTracked: boolean;
};

const MIN_INTERVAL_MS = 120;
const MAX_INTERVAL_MS = 900;
const DEFAULT_INTERVAL_MS = 500; // POLL_INTERVAL_MS do live-detections-poller

function detectionKey(detection: LiveDetection): { key: string; isTracked: boolean } {
  // trackId != null (e não `||`): 0 é um trackId legítimo.
  if (detection.trackId != null) {
    return { key: `track-${detection.trackId}`, isTracked: true };
  }
  return { key: detection.id, isTracked: false };
}

function lerpBox(
  from: [number, number, number, number],
  to: [number, number, number, number],
  t: number,
): [number, number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    from[0] + (to[0] - from[0]) * clamped,
    from[1] + (to[1] - from[1]) * clamped,
    from[2] + (to[2] - from[2]) * clamped,
    from[3] + (to[3] - from[3]) * clamped,
  ];
}

export function useSmoothTracks(
  detections: LiveDetection[],
  options?: { holdMs?: number },
): SmoothDetection[] {
  const holdMs = options?.holdMs ?? 900;
  const tracksRef = useRef<Map<string, TrackState>>(new Map());
  const rafRef = useRef<number | null>(null);
  const [rendered, setRendered] = useState<SmoothDetection[]>([]);

  // Ingestão de amostras: atualiza alvos SEM recriar identidades.
  useEffect(() => {
    const now = performance.now();
    const tracks = tracksRef.current;
    const seenNow = new Set<string>();

    for (const detection of detections) {
      const { key, isTracked } = detectionKey(detection);
      if (seenNow.has(key)) continue; // dedupe defensivo por identidade
      seenNow.add(key);
      const existing = tracks.get(key);
      if (!existing) {
        tracks.set(key, {
          meta: detection,
          from: [...detection.bbox] as [number, number, number, number],
          target: [...detection.bbox] as [number, number, number, number],
          targetSetAt: now,
          intervalMs: DEFAULT_INTERVAL_MS,
          lastSeen: now,
          isTracked,
        });
        continue;
      }
      // ponto de partida = posição INTERPOLADA atual (sem "teleporte" se a
      // amostra nova chegar no meio de uma animação)
      const progress = existing.intervalMs > 0 ? (now - existing.targetSetAt) / existing.intervalMs : 1;
      existing.from = lerpBox(existing.from, existing.target, progress);
      const observedInterval = now - existing.targetSetAt;
      existing.intervalMs = Math.max(
        MIN_INTERVAL_MS,
        Math.min(MAX_INTERVAL_MS, observedInterval || DEFAULT_INTERVAL_MS),
      );
      existing.target = [...detection.bbox] as [number, number, number, number];
      existing.targetSetAt = now;
      existing.lastSeen = now;
      existing.meta = detection;
    }

    // fallbacks (sem trackId) não têm continuidade entre amostras: remove os
    // que não vieram nesta leva, senão viram caixas-fantasma pelo TTL.
    for (const [key, state] of tracks) {
      if (!state.isTracked && !seenNow.has(key)) tracks.delete(key);
    }
  }, [detections]);

  // Loop de renderização: 60fps enquanto houver caixas vivas.
  useEffect(() => {
    const tick = () => {
      const now = performance.now();
      const tracks = tracksRef.current;
      const next: SmoothDetection[] = [];
      for (const [key, state] of tracks) {
        const age = now - state.lastSeen;
        if (age > holdMs) {
          tracks.delete(key);
          continue;
        }
        const t = state.intervalMs > 0 ? (now - state.targetSetAt) / state.intervalMs : 1;
        const bbox = lerpBox(state.from, state.target, t);
        next.push({
          ...state.meta,
          bbox,
          renderKey: key,
          coasting: age > state.intervalMs * 1.5,
        });
      }
      // ordena por identidade para a lista ser estável entre frames
      next.sort((a, b) => (a.renderKey < b.renderKey ? -1 : a.renderKey > b.renderKey ? 1 : 0));
      setRendered(next);
      rafRef.current = next.length > 0 ? requestAnimationFrame(tick) : null;
    };

    if (rafRef.current == null && (detections.length > 0 || tracksRef.current.size > 0)) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [detections, holdMs]);

  return rendered;
}
