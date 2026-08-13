"""Supressao de regioes CRONICAMENTE ativas (luz piscando, bandeira, agua,
folha ao vento) — sem mascara manual.

POR QUE ISTO EXISTE, e por que NAO e' o `avg_delta` do Frigate
--------------------------------------------------------------
Ao ler frigate/motion/frigate_motion.py de perto, o `avg_delta` acumulado dele
e' um filtro de PERSISTENCIA: exige que o delta dure alguns quadros, matando o
transiente breve (um pingo de chuva, um passaro que cruza um quadro so). Uma luz
que pisca SEMPRE no mesmo ponto NAO e' resolvida por ele — o delta se repete e
acumula. No Frigate, quem mata a luz piscando e' a mascara manual + a
confirmacao por objeto.

Este modulo mira o problema oposto ao do avg_delta, e resolve a luz piscando de
forma AUTOMATICA:

    Movimento REAL cruza cada regiao por pouco tempo (atividade baixa naquela
    celula). Uma luz piscando, bandeira ou agua ocupa a MESMA regiao uma fracao
    grande do tempo (atividade alta). Aprendendo, por pixel, a fracao de tempo
    em que ele fica "em movimento", da' para distinguir os dois e zerar so o
    cronico — antes de contar pixels e formar componentes.

Auto-aprende e auto-esquece: se a luz para de piscar, o mapa decai e a regiao
volta a valer em segundos. Nada de alguem desenhar mascara.

O tradeoff honesto: alguem PARADO se mexendo no mesmo ponto por muito tempo
(fumando na porta, por ex.) poderia elevar a atividade daquela celula. Mitigado
por (a) limiar alto — a celula precisa estar ativa perto de METADE de TODOS os
quadros da janela; (b) o proprio MOG2 ja absorve quem fica imovel no fundo. O
limiar e o alpha sao conservadores de proposito.
"""

from __future__ import annotations

import cv2
import numpy as np


class SupressorDeAtividadeCronica:
    """Aprende, por pixel, a fracao de tempo em movimento e suprime o cronico.

    Parametros
    ----------
    alpha : peso do quadro atual na media exponencial do mapa de atividade.
        0.02 a 2 fps ⇒ uma celula que pisca (ativa ~50% do tempo) chega ao
        regime em ~20 s; uma pessoa que atravessa (ativa 2-4 quadros) mal
        arranha 0,1. Menor = aprende/esquece mais devagar.
    limiar : fracao de atividade acima da qual a celula e' considerada cronica.
        0.45 = ativa perto de metade do tempo. Movimento real fica MUITO abaixo.
    warmup : quadros observados antes de suprimir qualquer coisa. Sem isto, os
        primeiros quadros (mapa ainda zerado ou instavel) poderiam suprimir
        errado ou nao suprimir nada de util.
    """

    def __init__(
        self,
        shape: tuple[int, int],
        alpha: float = 0.02,
        limiar: float = 0.45,
        warmup: int = 60,
    ) -> None:
        self._mapa = np.zeros(shape, dtype=np.float32)
        self._alpha = float(alpha)
        self._limiar = float(limiar)
        self._warmup = int(warmup)
        self._vistos = 0

    def atualizar_e_suprimir(self, fgmask: np.ndarray) -> np.ndarray:
        """Atualiza o mapa com a mascara atual e devolve a mascara SEM o cronico.

        `fgmask` e' 0/255 (saida do MOG2 apos sombra/zona/morfologia). O retorno
        e' uma copia com as regioes cronicas zeradas; durante o warmup devolve a
        propria mascara intacta.
        """
        ativo = (fgmask > 0).astype(np.float32)
        # Media exponencial por pixel: mapa[p] -> fracao de tempo que p fica ativo.
        cv2.accumulateWeighted(ativo, self._mapa, self._alpha)
        self._vistos += 1

        if self._vistos < self._warmup:
            return fgmask

        cronico = self._mapa >= self._limiar
        if not cronico.any():
            return fgmask

        saida = fgmask.copy()
        saida[cronico] = 0
        return saida

    def fracao_cronica(self) -> float:
        """Fracao do quadro marcada como cronicamente ativa — util em diagnostico."""
        return float(np.count_nonzero(self._mapa >= self._limiar)) / self._mapa.size

    def reiniciar(self) -> None:
        """Zera o aprendizado (ex.: recalibracao apos mudanca global de cena)."""
        self._mapa.fill(0.0)
        self._vistos = 0
