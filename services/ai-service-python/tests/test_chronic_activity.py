"""A supressao de atividade cronica mata luz piscando SEM matar movimento real.

Local (sem cv2) a classe e' PULADA; no container/CI com opencv, roda de verdade.

O que estes testes travam nao e' um numero de tela — e' a garantia dupla que
torna a tecnica segura de LIGAR por padrao:

  1. uma luz piscando (mesmo ponto, sempre) e' aprendida e zerada;
  2. um objeto atravessando (ponto novo a cada quadro) NUNCA e' suprimido.

Errar (1) devolve o cliente ao problema original: gravar a noite inteira por uma
luz. Errar (2) e' pior — apagaria uma pessoa de verdade da deteccao. Por isso os
dois lados sao verificados no mesmo teste, com a MESMA sequencia de estimulo.
"""

import unittest

import numpy as np

try:
    import cv2  # noqa: F401
    from detectors.chronic_activity import SupressorDeAtividadeCronica

    HAS_CV2 = True
except Exception:  # pragma: no cover
    HAS_CV2 = False


@unittest.skipUnless(HAS_CV2, "opencv ausente (roda no container/CI)")
class TestSupressaoCronica(unittest.TestCase):
    H, W = 60, 80

    def _mask_vazia(self):
        return np.zeros((self.H, self.W), dtype=np.uint8)

    def _bloco(self, mask, y, x, lado=6):
        mask[y : y + lado, x : x + lado] = 255
        return mask

    def test_luz_piscando_e_suprimida(self):
        # Bloco fixo que liga/desliga a cada quadro — a assinatura de uma luz.
        s = SupressorDeAtividadeCronica((self.H, self.W), alpha=0.05, limiar=0.4, warmup=40)
        ligado = False
        for _ in range(200):
            m = self._mask_vazia()
            ligado = not ligado
            if ligado:
                self._bloco(m, 20, 30)
            m = s.atualizar_e_suprimir(m)
        # Ultimo quadro em que a luz estava LIGADA: nao pode restar movimento.
        m = self._bloco(self._mask_vazia(), 20, 30)
        m = s.atualizar_e_suprimir(m)
        self.assertEqual(
            int(np.count_nonzero(m)), 0,
            "a luz piscando sobreviveu — o cliente volta a gravar a noite toda",
        )

    def test_pessoa_atravessando_NAO_e_suprimida(self):
        # Bloco que anda pela cena — cada coluna e' tocada por poucos quadros.
        s = SupressorDeAtividadeCronica((self.H, self.W), alpha=0.05, limiar=0.4, warmup=40)
        # Aquece com cena parada para o supressor sair do warmup.
        for _ in range(45):
            s.atualizar_e_suprimir(self._mask_vazia())
        sobreviveu = 0
        for x in range(0, self.W - 6, 3):  # atravessa da esquerda p/ direita
            m = self._bloco(self._mask_vazia(), 25, x)
            m = s.atualizar_e_suprimir(m)
            if int(np.count_nonzero(m)) > 0:
                sobreviveu += 1
        self.assertGreaterEqual(
            sobreviveu, 20,
            "movimento real foi suprimido — apagaria uma pessoa da deteccao",
        )

    def test_luz_que_PARA_de_piscar_e_esquecida(self):
        # Aprende a luz; depois ela some. A regiao tem que voltar a valer.
        s = SupressorDeAtividadeCronica((self.H, self.W), alpha=0.1, limiar=0.4, warmup=30)
        ligado = False
        for _ in range(120):  # aprende a luz
            m = self._mask_vazia()
            ligado = not ligado
            if ligado:
                self._bloco(m, 20, 30)
            s.atualizar_e_suprimir(m)
        self.assertGreater(s.fracao_cronica(), 0.0, "deveria ter aprendido a luz")
        for _ in range(120):  # luz apagada — deve esquecer
            s.atualizar_e_suprimir(self._mask_vazia())
        self.assertEqual(
            s.fracao_cronica(), 0.0,
            "a regiao ficou cega para sempre — objeto que aparecer ali some",
        )

    def test_warmup_nao_suprime_nada(self):
        # Antes do warmup, a mascara sai intacta — mesmo com bloco cronico.
        s = SupressorDeAtividadeCronica((self.H, self.W), alpha=0.5, limiar=0.1, warmup=50)
        for _ in range(10):
            m = self._bloco(self._mask_vazia(), 20, 30)
            out = s.atualizar_e_suprimir(m)
            self.assertEqual(int(np.count_nonzero(out)), int(np.count_nonzero(m)))

    def test_mudanca_global_nao_e_suprimida(self):
        # Cena estavel por muito tempo, e entao a tela INTEIRA acende de uma vez
        # (luz da sala). Esses pixels NAO eram cronicos — nao podem ser zerados.
        s = SupressorDeAtividadeCronica((self.H, self.W), alpha=0.05, limiar=0.4, warmup=40)
        for _ in range(80):
            s.atualizar_e_suprimir(self._mask_vazia())
        cheia = np.full((self.H, self.W), 255, dtype=np.uint8)
        out = s.atualizar_e_suprimir(cheia)
        self.assertEqual(
            int(np.count_nonzero(out)), self.H * self.W,
            "a mudanca global foi suprimida — nao gravaria quando a luz acende",
        )

    def test_nao_altera_a_mascara_recebida_no_lugar(self):
        # Efeito colateral: a mascara de entrada nao pode ser mutada (a camada de
        # cima ainda a usa).
        s = SupressorDeAtividadeCronica((self.H, self.W), alpha=0.5, limiar=0.1, warmup=1)
        for _ in range(5):
            s.atualizar_e_suprimir(self._bloco(self._mask_vazia(), 20, 30))
        entrada = self._bloco(self._mask_vazia(), 20, 30)
        antes = entrada.copy()
        s.atualizar_e_suprimir(entrada)
        self.assertTrue(np.array_equal(entrada, antes), "a mascara de entrada foi mutada")


if __name__ == "__main__":
    unittest.main()
