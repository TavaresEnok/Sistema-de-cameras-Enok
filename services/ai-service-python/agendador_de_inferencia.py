"""QUANDO rodar o detector pesado — por RAZÃO, não por relógio.

Seção 9 da análise completa, que a chama de "uma das mudanças de maior
importância":

    O YOLO deve rodar quando existir uma razão de inferência.
    Se nenhuma condição existir: NÃO rodar detector pesado.

Hoje a decisão é só intervalo de tempo — o detector roda a cada 1/fps segundos
independentemente de haver o que ver. Numa rua vazia às 3h da manhã isso gasta
processador (ou GPU) analisando nada, e foi o que medimos em 15/08/2026: o
serviço consumindo com zero detecções por não haver ninguém na cena.

Existe também um erro na direção oposta, e é por isso que a varredura periódica
faz parte da lista: detectar SÓ por movimento cega o sistema para quem já
estava lá quando a câmera subiu, e para quem parou de se mexer. O Frigate usa
movimento como primeira linha, não como única.

Este módulo é só a DECISÃO — puro, sem OpenCV e sem estado global, para poder
ser testado fora do contêiner de visão computacional.
"""

from dataclasses import dataclass

# Razões possíveis, em ordem de prioridade para o log. A ordem não muda a
# decisão (basta uma), mas muda o que se lê no diagnóstico: "movimento" é a
# razão interessante; "varredura" significa que nada acontecia.
RAZAO_MOVIMENTO = "movimento"
RAZAO_RASTRO_ATIVO = "rastro-ativo"
RAZAO_REVER_PARADO = "rever-parado"
RAZAO_VARREDURA_INICIAL = "varredura-inicial"
RAZAO_VARREDURA_PERIODICA = "varredura-periodica"
RAZAO_RECUPERACAO = "recuperacao-de-camera"


@dataclass(frozen=True)
class Decisao:
    rodar: bool
    razao: str | None


@dataclass
class OrcamentoDeInferencia:
    """Tetos que valem para QUALQUER razão.

    O intervalo mínimo continua existindo — trocar "por relógio" por "por
    razão" não pode virar "a cada quadro com movimento", que numa rua
    movimentada seria pior que hoje.
    """

    intervalo_minimo_s: float = 0.125
    """1/fps: nunca roda mais rápido que isto, mesmo com razão de sobra."""

    varredura_periodica_s: float = 10.0
    """De quanto em quanto tempo varre mesmo sem razão nenhuma. É a rede que
    impede cegueira para quem entrou durante uma falha do movimento ou parou."""

    rever_parado_s: float = 5.0
    """Objeto classificado como parado é reavaliado neste intervalo — senão
    'parado' vira 'esquecido' e a pessoa que foi embora fica na tela."""


def decidir_inferencia(
    *,
    agora: float,
    ultima_inferencia: float,
    orcamento: OrcamentoDeInferencia,
    ha_movimento: bool = False,
    ha_rastro_ativo: bool = False,
    ultima_varredura: float = 0.0,
    ultima_revisao_de_parado: float | None = None,
    ja_fez_varredura_inicial: bool = True,
    camera_se_moveu: bool = False,
) -> Decisao:
    """Rodar o detector pesado agora? E por quê?

    O teto de frequência é verificado ANTES de qualquer razão: sem isso, cena
    com movimento contínuo (chuva, árvore, rua cheia) faria o detector rodar em
    todo quadro e o orçamento de máquina iria embora.

    A varredura inicial ignora o teto de propósito: quando a câmera acaba de
    subir não há histórico nenhum, e esperar o primeiro intervalo é cegueira
    gratuita no momento em que alguém mais provavelmente está olhando.
    """
    if not ja_fez_varredura_inicial:
        return Decisao(True, RAZAO_VARREDURA_INICIAL)

    if agora - ultima_inferencia < orcamento.intervalo_minimo_s:
        return Decisao(False, None)

    if camera_se_moveu:
        return Decisao(True, RAZAO_RECUPERACAO)
    if ha_movimento:
        return Decisao(True, RAZAO_MOVIMENTO)
    if ha_rastro_ativo:
        return Decisao(True, RAZAO_RASTRO_ATIVO)

    if (
        ultima_revisao_de_parado is not None
        and agora - ultima_revisao_de_parado >= orcamento.rever_parado_s
    ):
        return Decisao(True, RAZAO_REVER_PARADO)

    if agora - ultima_varredura >= orcamento.varredura_periodica_s:
        return Decisao(True, RAZAO_VARREDURA_PERIODICA)

    return Decisao(False, None)
