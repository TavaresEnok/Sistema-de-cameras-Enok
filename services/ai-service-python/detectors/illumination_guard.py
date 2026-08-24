"""Compensacao de mudanca GLOBAL de iluminacao antes do detector de movimento.

Nuvem, exposicao automatica, farol e luz ambiente deslocam a luminancia de
quase todos os pixels na mesma direcao. Isso nao e movimento geometrico. Uma
pessoa, por outro lado, altera apenas parte da imagem e deixa um residuo local
depois que o deslocamento global de luz e removido.

O guarda mantem uma referencia lenta da luminancia, estima o deslocamento
global robustamente pela mediana e so compensa quando a mudanca e coerente em
blocos espalhados pelo quadro E pixel a pixel. Essa dupla verificacao impede
que um objeto grande ou a camera se movendo seja confundido com iluminacao.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class IlluminationDecision:
    photometric: bool = False
    offset: float = 0.0
    changed_ratio: float = 0.0
    uniform_ratio: float = 0.0
    block_uniform_ratio: float = 0.0


class GlobalIlluminationGuard:
    """Detecta e neutraliza deslocamentos fotometricos globais."""

    def __init__(
        self,
        shape: tuple[int, int],
        *,
        min_shift: float = 8.0,
        residual_threshold: float = 10.0,
        uniform_ratio: float = 0.72,
        block_uniform_ratio: float = 0.75,
        grid_x: int = 8,
        grid_y: int = 6,
        alpha: float = 0.02,
        recovery_alpha: float = 0.02,
    ) -> None:
        self._shape = tuple(int(v) for v in shape)
        self._min_shift = max(1.0, float(min_shift))
        self._residual_threshold = max(1.0, float(residual_threshold))
        self._uniform_ratio = min(1.0, max(0.5, float(uniform_ratio)))
        self._block_uniform_ratio = min(1.0, max(0.5, float(block_uniform_ratio)))
        self._grid_x = max(2, int(grid_x))
        self._grid_y = max(2, int(grid_y))
        self._alpha = min(1.0, max(0.001, float(alpha)))
        self._recovery_alpha = min(1.0, max(self._alpha, float(recovery_alpha)))
        self._reference: np.ndarray | None = None
        self.last = IlluminationDecision()

    @staticmethod
    def _gray(frame: np.ndarray) -> np.ndarray:
        if frame.ndim == 2:
            return frame
        return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    def reset(self, gray: np.ndarray | None = None) -> None:
        self._reference = None if gray is None else gray.astype(np.float32, copy=True)
        self.last = IlluminationDecision()

    def _valid_pixels(self, values: np.ndarray, mask: np.ndarray | None) -> np.ndarray:
        if mask is None:
            return values.reshape(-1)
        return values[mask > 0]

    def _block_offsets(self, delta: np.ndarray, mask: np.ndarray | None) -> list[float]:
        height, width = delta.shape
        offsets: list[float] = []
        for gy in range(self._grid_y):
            y1 = gy * height // self._grid_y
            y2 = (gy + 1) * height // self._grid_y
            for gx in range(self._grid_x):
                x1 = gx * width // self._grid_x
                x2 = (gx + 1) * width // self._grid_x
                block = delta[y1:y2, x1:x2]
                block_mask = None if mask is None else mask[y1:y2, x1:x2]
                values = self._valid_pixels(block, block_mask)
                # Zona minuscula dentro do bloco nao representa a cena.
                if values.size >= 16:
                    offsets.append(float(np.median(values)))
        return offsets

    def compensate(
        self,
        frame: np.ndarray,
        *,
        mask: np.ndarray | None = None,
    ) -> tuple[np.ndarray, IlluminationDecision]:
        """Devolve o frame para analise e a decisao fotometrica.

        O frame original nunca e alterado. Quando a mudanca nao e fotometrica,
        a mesma referencia e devolvida para manter o caminho rapido sem copia.
        """
        gray = self._gray(frame)
        if gray.shape != self._shape:
            self._shape = gray.shape
            self.reset(gray)
            return frame, self.last
        if self._reference is None:
            self.reset(gray)
            return frame, self.last

        delta = gray.astype(np.float32) - self._reference
        values = self._valid_pixels(delta, mask)
        # Uma mascara vazia nao autoriza usar pixels externos como fallback:
        # isso faria farol/nuvem fora da zona interferir na zona monitorada.
        if values.size < 16:
            cv2.accumulateWeighted(gray, self._reference, self._alpha)
            self.last = IlluminationDecision()
            return frame, self.last
        offset = float(np.median(values))
        residual = np.abs(values - offset)
        changed_ratio = float(np.mean(np.abs(values) >= self._min_shift))
        uniform_ratio = float(np.mean(residual <= self._residual_threshold))

        block_offsets = self._block_offsets(delta, mask)
        if block_offsets:
            block_values = np.asarray(block_offsets, dtype=np.float32)
            same_direction = np.sign(block_values) == np.sign(offset)
            close_to_global = np.abs(block_values - offset) <= self._residual_threshold
            block_uniform_ratio = float(np.mean(same_direction & close_to_global))
        else:
            block_uniform_ratio = 0.0

        photometric = bool(
            abs(offset) >= self._min_shift
            and changed_ratio >= 0.60
            and uniform_ratio >= self._uniform_ratio
            and block_uniform_ratio >= self._block_uniform_ratio
        )
        decision = IlluminationDecision(
            photometric=photometric,
            offset=round(offset, 3),
            changed_ratio=round(changed_ratio, 4),
            uniform_ratio=round(uniform_ratio, 4),
            block_uniform_ratio=round(block_uniform_ratio, 4),
        )
        self.last = decision

        alpha = self._recovery_alpha if photometric else self._alpha
        cv2.accumulateWeighted(gray, self._reference, alpha)

        if not photometric:
            return frame, decision

        # Subtrair o deslocamento preserva o contraste LOCAL do objeto. Em BGR
        # a mesma correcao escalar e aplicada aos tres canais; no plano Y, ao
        # unico canal. int16 evita wrap-around de uint8.
        corrected = np.clip(frame.astype(np.int16) - int(round(offset)), 0, 255).astype(np.uint8)
        return corrected, decision

    def diagnostics(self) -> dict:
        return {
            "photometric": self.last.photometric,
            "offset": self.last.offset,
            "changed_ratio": self.last.changed_ratio,
            "uniform_ratio": self.last.uniform_ratio,
            "block_uniform_ratio": self.last.block_uniform_ratio,
        }
