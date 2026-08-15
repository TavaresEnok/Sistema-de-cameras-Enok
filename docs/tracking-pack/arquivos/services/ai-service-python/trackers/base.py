"""Contrato comum dos backends de tracking.

O ObjectDetector conversa APENAS com esta interface. Nenhum backend recebe ou
devolve tipos do supervision — só numpy — para que trocar de tracker nunca
espalhe condicionais pelo detector.

Convenções:
    - Um backend por (câmera, classe), igual ao comportamento atual.
    - `update` é chamado uma vez por frame processado, mesmo sem detecções
      (lista vazia), para que misses/oclusão avancem no tempo.
    - `track_id` é o id CRU do backend (>= 1). O detector continua compondo o
      id público como `classe * 100000 + track_id`, preservando o formato que o
      frontend já conhece.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class TrackedBox:
    bbox: np.ndarray            # xyxy float32, coordenadas do frame inteiro
    confidence: float
    class_id: int
    track_id: int               # id cru do backend (>= 1)
    stationary: bool = False    # objeto classificado como parado
    recovered: bool = False     # id recuperado após oclusão/perda
    misses: int = 0             # frames consecutivos sem observação
    extra: dict = field(default_factory=dict)


class TrackerBackend:
    """Interface mínima. Backends devem ser baratos de instanciar (1 por classe)."""

    name = "base"

    def __init__(self, class_id: int, activation_threshold: float,
                 lost_track_buffer: int, frame_rate: int, **_ignored):
        self.class_id = int(class_id)
        self.activation_threshold = float(activation_threshold)
        self.lost_track_buffer = int(lost_track_buffer)
        self.frame_rate = max(1, int(frame_rate))

    def update(self, xyxy: np.ndarray, confidences: np.ndarray, frame=None) -> list[TrackedBox]:
        """Recebe (N,4) float e (N,) float; devolve as caixas rastreadas do frame.

        `frame` (BGR, opcional) habilita recursos de aparência em backends que
        suportam; backends que não usam simplesmente ignoram."""
        raise NotImplementedError

    def apply_global_shift(self, dx: float, dy: float, scale: float = 1.0) -> None:
        """Compensação de movimento global da câmera (PTZ/vibração/ZOOM).

        `scale` != 1.0 representa zoom óptico/digital entre dois frames — as
        predições são escaladas antes de deslocar. Chamado ANTES de `update`
        quando GENERAL_CAMERA_MOTION_COMP=true. Backends sem suporte ignoram.
        """
        return None

    def status(self) -> dict:
        return {"name": self.name, "class_id": self.class_id}
