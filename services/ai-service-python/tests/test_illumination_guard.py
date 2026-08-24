"""Regressoes contra nuvem, luz, exposicao e objeto junto da mudanca de luz."""

import unittest

import cv2
import numpy as np

from detectors.illumination_guard import GlobalIlluminationGuard


class TestGlobalIlluminationGuard(unittest.TestCase):
    H, W = 180, 320

    @classmethod
    def _textured(cls, level=90):
        yy, xx = np.mgrid[0:cls.H, 0:cls.W]
        gray = np.clip(level + 18 * np.sin(xx / 11.0) + 12 * np.cos(yy / 9.0), 0, 255)
        return np.repeat(gray[..., None], 3, axis=2).astype(np.uint8)

    def test_luz_global_e_compensada(self):
        base = self._textured()
        guard = GlobalIlluminationGuard(base.shape[:2])
        guard.compensate(base)

        claro = np.clip(base.astype(np.int16) + 42, 0, 255).astype(np.uint8)
        corrigido, decision = guard.compensate(claro)

        self.assertTrue(decision.photometric)
        self.assertAlmostEqual(decision.offset, 42.0, delta=1.0)
        self.assertLess(float(np.mean(np.abs(corrigido.astype(np.int16) - base.astype(np.int16)))), 1.5)

    def test_objeto_local_nao_e_compensado(self):
        base = self._textured()
        guard = GlobalIlluminationGuard(base.shape[:2])
        guard.compensate(base)
        objeto = base.copy()
        objeto[55:145, 135:180] = 230

        corrigido, decision = guard.compensate(objeto)

        self.assertFalse(decision.photometric)
        self.assertIs(corrigido, objeto, "caminho comum nao deve copiar nem alterar o frame")

    def test_camera_deslocada_nao_parece_iluminacao(self):
        base = self._textured()
        guard = GlobalIlluminationGuard(base.shape[:2])
        guard.compensate(base)
        movida = np.roll(base, 24, axis=1)

        _, decision = guard.compensate(movida)

        self.assertFalse(decision.photometric, "movimento geometrico global nao pode ser suprimido como luz")

    def test_luz_global_mais_pessoa_preserva_residuo_da_pessoa(self):
        base = self._textured()
        guard = GlobalIlluminationGuard(base.shape[:2])
        guard.compensate(base)
        cena = np.clip(base.astype(np.int16) + 35, 0, 255).astype(np.uint8)
        cena[55:145, 135:180] = np.clip(cena[55:145, 135:180].astype(np.int16) + 55, 0, 255)

        corrigido, decision = guard.compensate(cena)

        self.assertTrue(decision.photometric)
        fora = np.ones((self.H, self.W), dtype=bool)
        fora[55:145, 135:180] = False
        base_gray = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY)
        corrected_gray = cv2.cvtColor(corrigido, cv2.COLOR_BGR2GRAY)
        self.assertLess(float(np.mean(np.abs(corrected_gray[fora].astype(int) - base_gray[fora].astype(int)))), 2.0)
        self.assertGreater(float(np.mean(corrected_gray[~fora].astype(int) - base_gray[~fora].astype(int))), 40.0)

    def test_mudanca_fora_da_zona_nao_dirige_decisao(self):
        base = self._textured()
        guard = GlobalIlluminationGuard(base.shape[:2])
        guard.compensate(base)
        mask = np.zeros(base.shape[:2], dtype=np.uint8)
        mask[45:135, 80:240] = 255
        cena = base.copy()
        cena[:, :70] = np.clip(cena[:, :70].astype(np.int16) + 90, 0, 255)

        corrigido, decision = guard.compensate(cena, mask=mask)

        self.assertFalse(decision.photometric)
        self.assertIs(corrigido, cena)


if __name__ == "__main__":
    unittest.main()
