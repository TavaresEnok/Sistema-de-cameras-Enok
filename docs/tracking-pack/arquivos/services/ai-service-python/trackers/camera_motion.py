"""Estimativa de movimento GLOBAL da câmera (PTZ / vibração / vento no poste).

Mesma ideia da compensação do Frigate: antes de associar detecções às trilhas,
descobrir quanto A CÂMERA se moveu e descontar isso das predições — senão um
pan de 30px vira "todo mundo andou 30px" e os IDs trocam em bloco.

Implementação barata: optical flow esparso (Lucas-Kanade) sobre uma grade fixa
de pontos em um frame reduzido em escala de cinza; o deslocamento global é a
MEDIANA dos vetores (robusta a objetos que realmente se movem, desde que não
cubram o quadro inteiro). Custa ~1–2 ms em 320px de largura.

Uso (um estimador por câmera):

    shift = estimator.estimate(frame_bgr)   # (dx, dy) em pixels do frame CHEIO
    backend.apply_global_shift(*shift)

Desligado por padrão (GENERAL_CAMERA_MOTION_COMP=false). Em câmera fixa o
resultado é ~(0,0) e não muda nada; ligue apenas em PTZ ou câmeras que tremem.
"""
from __future__ import annotations

import numpy as np

try:
    import cv2
except Exception:  # pragma: no cover - ambiente de teste sem opencv
    cv2 = None


class GlobalMotionEstimator:
    def __init__(self, work_width: int = 320, grid: int = 8, max_shift_px: int = 120):
        self.work_width = int(work_width)
        self.grid = int(grid)
        self.max_shift_px = float(max_shift_px)
        self._prev_gray: np.ndarray | None = None
        self._scale = 1.0

    def reset(self) -> None:
        self._prev_gray = None

    def estimate(self, frame_bgr) -> tuple[float, float, float]:
        if cv2 is None or frame_bgr is None:
            return (0.0, 0.0, 1.0)
        height, width = frame_bgr.shape[:2]
        if width <= 0 or height <= 0:
            return (0.0, 0.0, 1.0)
        self._scale = self.work_width / float(width)
        small = cv2.resize(frame_bgr, (self.work_width, max(1, int(height * self._scale))))
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

        if self._prev_gray is None or self._prev_gray.shape != gray.shape:
            self._prev_gray = gray
            return (0.0, 0.0, 1.0)

        gh, gw = gray.shape
        # Cantos reais rastreiam muito melhor que uma grade cega (parede lisa,
        # céu). Se a cena for pobre em textura, cai para a grade fixa.
        points = cv2.goodFeaturesToTrack(
            self._prev_gray, maxCorners=120, qualityLevel=0.01,
            minDistance=8, blockSize=7,
        )
        if points is None or len(points) < 24:
            xs = np.linspace(gw * 0.1, gw * 0.9, self.grid)
            ys = np.linspace(gh * 0.1, gh * 0.9, self.grid)
            points = np.array([[x, y] for y in ys for x in xs], dtype=np.float32).reshape(-1, 1, 2)
        points = np.asarray(points, dtype=np.float32).reshape(-1, 1, 2)

        moved, status, _err = cv2.calcOpticalFlowPyrLK(
            self._prev_gray, gray, points, None,
            winSize=(21, 21), maxLevel=2,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03),
        )
        self._prev_gray = gray
        if moved is None or status is None:
            return (0.0, 0.0, 1.0)
        ok = status.reshape(-1) == 1
        if ok.sum() < max(6, (self.grid * self.grid) // 4):
            return (0.0, 0.0, 1.0)
        prev_pts = points.reshape(-1, 2)[ok]
        cur_pts = moved.reshape(-1, 2)[ok]

        # ZOOM (PTZ): afim de similaridade prev→cur com RANSAC; a diagonal dá a
        # escala, a translação sai da própria matriz (em coords do frame CHEIO:
        # P_cur = A·P_prev + t/k, com k = fator de redução do frame de trabalho).
        scale = 1.0
        dx = dy = 0.0
        try:
            matrix, inliers = cv2.estimateAffinePartial2D(
                prev_pts, cur_pts, method=cv2.RANSAC,
                ransacReprojThreshold=3.0, maxIters=500,
            )
        except Exception:
            matrix, inliers = None, None
        # fit degenerado (poucos inliers RELATIVOS) = ruído, não movimento real.
        # 25%: zoom grande gera residuais maiores longe da origem e derruba a
        # fração legítima; ruído puro fica bem abaixo (medido: 16% no bench).
        min_inliers = max(12, int(0.25 * len(prev_pts)))
        if matrix is not None and inliers is not None and int(inliers.sum()) >= min_inliers:
            a, b = float(matrix[0, 0]), float(matrix[1, 0])
            estimated = float(np.hypot(a, b))
            if 0.7 <= estimated <= 1.4:  # zoom plausível entre 2 frames
                scale = estimated
            dx = float(matrix[0, 2]) / self._scale
            dy = float(matrix[1, 2]) / self._scale
        else:
            flow = cur_pts - prev_pts
            dx = float(np.median(flow[:, 0])) / self._scale
            dy = float(np.median(flow[:, 1])) / self._scale

        # zonas mortas: ruído de sensor não vira "movimento de câmera"
        if abs(scale - 1.0) < 0.005:
            scale = 1.0
        if abs(dx) < 0.7 and abs(dy) < 0.7 and scale == 1.0:
            return (0.0, 0.0, 1.0)
        dx = float(np.clip(dx, -self.max_shift_px, self.max_shift_px))
        dy = float(np.clip(dy, -self.max_shift_px, self.max_shift_px))
        return (dx, dy, scale)
