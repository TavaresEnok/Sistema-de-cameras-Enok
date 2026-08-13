"""Descarta disparos PERIODICOS na mesma regiao — o que pisca com relogio.

Complementa a supressao de atividade cronica (chronic_activity.py), que so pega
o que fica ativo boa parte do tempo. Uma luz que pisca DEVAGAR (a cada 8-10 s)
tem fracao de atividade baixa — passa incolume pelo mapa cronico — e ainda assim
gera gravacao a noite inteira. Foi a lacuna encontrada ao revisar a propria
solucao anterior.

A ideia, que nao copiei de nenhum concorrente (ZoneMinder tem `OverloadFrames`,
que so silencia depois de uma rajada; Frigate depende de mascara manual):

    O que e' MECANICO tem relogio. Luz de aviso, letreiro, ventilador, LED de
    equipamento: o intervalo entre disparos e' quase constante. Gente e' irregular
    — chega, para, volta, demora. Entao, por regiao, guardamos os instantes de
    disparo e medimos a REGULARIDADE dos intervalos. Regularidade alta e' assinatura
    de maquina, e maquina nao e' evento de seguranca.

A medida e' o coeficiente de variacao (desvio/media) dos intervalos:

    CV proximo de 0   → intervalos identicos  → mecanico
    CV alto           → intervalos irregulares → humano/natural

Salvaguardas, porque suprimir movimento real e' pior que gravar demais:
  - exige um MINIMO de disparos antes de julgar (nao decide com 2 amostras);
  - so suprime com CV MUITO baixo (padrao 0.15 = intervalos variando <15%);
  - a regiao e' grosseira (grade), entao uma pessoa que ande pela cena cai em
    celulas diferentes e nunca acumula historico periodico numa so;
  - a janela e' curta e deslizante: se a luz para, o historico expira e a regiao
    volta a valer.
"""

from __future__ import annotations

import math
from collections import defaultdict, deque


class DetectorDePeriodicidade:
    """Marca como periodica a regiao cujos disparos tem intervalo regular.

    Parametros
    ----------
    celulas : divisoes por eixo. 8 => grade 8x8. Grosseiro de proposito: fino
        demais faria cada passo de uma pessoa cair em celula nova (nunca acumula
        historico) e tambem faria a luz "vazar" entre celulas vizinhas.
    minimo_amostras : disparos necessarios na celula antes de julgar. Com poucos
        pontos qualquer coisa parece regular.
    cv_maximo : coeficiente de variacao abaixo do qual se considera mecanico.
    janela : quantos instantes guardar por celula (deslizante).
    expiracao_s : intervalos maiores que isto quebram a sequencia — a luz parou,
        o historico nao vale mais.
    """

    def __init__(
        self,
        celulas: int = 8,
        minimo_amostras: int = 6,
        cv_maximo: float = 0.15,
        janela: int = 12,
        expiracao_s: float = 60.0,
    ) -> None:
        self._celulas = max(2, int(celulas))
        self._minimo = max(4, int(minimo_amostras))
        self._cv_maximo = float(cv_maximo)
        self._janela = max(self._minimo, int(janela))
        self._expiracao = float(expiracao_s)
        self._hist: dict[tuple[int, int], deque] = defaultdict(lambda: deque(maxlen=self._janela))

    def _celula(self, caixa, largura: int, altura: int) -> tuple[int, int]:
        x1, y1, x2, y2 = caixa
        cx = (x1 + x2) / 2.0
        cy = (y1 + y2) / 2.0
        gx = min(self._celulas - 1, max(0, int(cx * self._celulas / max(1, largura))))
        gy = min(self._celulas - 1, max(0, int(cy * self._celulas / max(1, altura))))
        return (gx, gy)

    @staticmethod
    def _coef_variacao(intervalos: list[float]) -> float:
        """Desvio/media dos intervalos. 0 = perfeitamente regular."""
        n = len(intervalos)
        media = sum(intervalos) / n
        if media <= 0:
            return math.inf
        var = sum((i - media) ** 2 for i in intervalos) / n
        return math.sqrt(var) / media

    def e_periodico(self, caixa, largura: int, altura: int, agora: float) -> bool:
        """Registra o disparo e diz se aquela regiao esta batendo como relogio."""
        chave = self._celula(caixa, largura, altura)
        h = self._hist[chave]

        # Sequencia quebrada (a luz parou por um tempo): recomeca a contagem.
        if h and (agora - h[-1]) > self._expiracao:
            h.clear()

        h.append(agora)
        if len(h) < self._minimo:
            return False

        intervalos = [h[i] - h[i - 1] for i in range(1, len(h))]
        if any(i <= 0 for i in intervalos):
            return False
        return self._coef_variacao(intervalos) <= self._cv_maximo

    def esquecer(self) -> None:
        """Zera o historico (ex.: recalibracao apos mudanca global de cena)."""
        self._hist.clear()
