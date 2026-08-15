"""Assinatura de aparência para re-identificação — barata e sem modelo extra.

Um histograma HSV 2D (matiz × saturação) do TORSO da pessoa (60% superiores da
caixa — camisa/cabeça são estáveis; pernas alternam e o chão contamina). Custo:
~0,1 ms por caixa. Não é um embedding neural — é deliberadamente simples:

    - CONFIRMA recuperação de ID após oclusão longa (a pessoa que voltou tem a
      mesma "cor" da que sumiu?);
    - VETA associação obviamente errada em cruzamento difícil (camisa verde não
      vira camisa vermelha de um frame para o outro);
    - NUNCA cria vínculo sozinha: só ajusta custos da associação geométrica.

Limites honestos: gêmeos de camisa preta continuam ambíguos (como em qualquer
re-ID por cor), e mudança BRUSCA de iluminação durante uma oclusão pode impedir
uma recuperação (vira ID novo — o comportamento de hoje, nunca pior). A
assinatura da trilha é uma média móvel, então mudanças GRADUAIS de luz são
acompanhadas.
"""
from __future__ import annotations

import numpy as np

try:
    import cv2
except Exception:  # pragma: no cover
    cv2 = None

H_BINS = 16
S_BINS = 8


def signature(frame_bgr, bbox) -> np.ndarray | None:
    """Histograma HSV normalizado do torso. None se não computável (sem cv2,
    caixa fora do frame, área minúscula) — e None desliga a aparência para
    aquela detecção, sem quebrar nada."""
    if cv2 is None or frame_bgr is None:
        return None
    height, width = frame_bgr.shape[:2]
    x1 = int(max(0, min(width - 1, bbox[0])))
    y1 = int(max(0, min(height - 1, bbox[1])))
    x2 = int(max(x1 + 1, min(width, bbox[2])))
    y2 = int(max(y1 + 1, min(height, bbox[3])))
    torso_bottom = y1 + max(1, int((y2 - y1) * 0.6))
    crop = frame_bgr[y1:torso_bottom, x1:x2]
    if crop.size < 48:  # caixa minúscula: histograma vira ruído
        return None
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [H_BINS, S_BINS], [0, 180, 0, 256])
    total = float(hist.sum())
    if total <= 0:
        return None
    return (hist / total).astype(np.float32).reshape(-1)


def similarity(a: np.ndarray | None, b: np.ndarray | None) -> float | None:
    """Interseção de histogramas em [0..1]. None quando falta assinatura de um
    dos lados (aparência indisponível → decisão fica 100% geométrica)."""
    if a is None or b is None:
        return None
    return float(np.minimum(a, b).sum())


def blend(old: np.ndarray | None, new: np.ndarray | None, alpha: float = 0.3) -> np.ndarray | None:
    """Média móvel da assinatura da trilha (acompanha mudança gradual de luz)."""
    if new is None:
        return old
    if old is None:
        return new
    return ((1.0 - alpha) * old + alpha * new).astype(np.float32)
