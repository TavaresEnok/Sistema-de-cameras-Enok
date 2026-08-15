"""O detector pesado roda por RAZÃO, não por relógio.

Seção 9 da análise completa. Medido em 15/08/2026: numa rua vazia às 3h da
manhã o serviço consumia processador analisando nada, porque a decisão era só
"passou 1/fps segundos desde a última vez".
"""

from agendador_de_inferencia import (
    RAZAO_MOVIMENTO,
    RAZAO_RASTRO_ATIVO,
    RAZAO_RECUPERACAO,
    RAZAO_REVER_PARADO,
    RAZAO_VARREDURA_INICIAL,
    RAZAO_VARREDURA_PERIODICA,
    Decisao,
    OrcamentoDeInferencia,
    decidir_inferencia,
)

ORC = OrcamentoDeInferencia(intervalo_minimo_s=0.125, varredura_periodica_s=10.0, rever_parado_s=5.0)


def _decidir(**kw):
    base = dict(agora=100.0, ultima_inferencia=99.0, orcamento=ORC, ultima_varredura=99.0)
    base.update(kw)
    return decidir_inferencia(**base)


def test_o_caso_real_cena_vazia_NAO_roda_o_detector():
    # Rua deserta: sem movimento, sem rastro, varredura recente. Antes rodava
    # do mesmo jeito, a cada 1/fps, gastando máquina para ver nada.
    d = _decidir(ha_movimento=False, ha_rastro_ativo=False)
    assert d == Decisao(False, None)


def test_movimento_e_razao_suficiente():
    assert _decidir(ha_movimento=True).razao == RAZAO_MOVIMENTO


def test_rastro_ativo_sustenta_a_analise_sem_movimento_novo():
    # Pessoa parada no meio da cena ainda precisa ser reconfirmada, senão a
    # caixa some de quem nunca saiu.
    assert _decidir(ha_rastro_ativo=True).razao == RAZAO_RASTRO_ATIVO


def test_o_TETO_de_frequencia_vale_para_QUALQUER_razao():
    # Sem isto, chuva ou árvore ao vento fariam o detector rodar em todo quadro
    # — pior que o comportamento que estamos substituindo.
    d = _decidir(agora=100.0, ultima_inferencia=99.95, ha_movimento=True)
    assert d.rodar is False


def test_varredura_inicial_ignora_o_teto_de_proposito():
    # Câmera que acabou de subir não tem histórico; esperar o primeiro
    # intervalo é cegueira gratuita.
    d = _decidir(agora=100.0, ultima_inferencia=100.0, ja_fez_varredura_inicial=False)
    assert d.razao == RAZAO_VARREDURA_INICIAL
    assert d.rodar is True


def test_varredura_periodica_impede_cegueira_em_cena_parada():
    # Detectar SÓ por movimento perde quem já estava lá antes da câmera subir e
    # quem parou de se mexer. O Frigate usa movimento como primeira linha, não
    # como única.
    d = _decidir(ultima_varredura=80.0, ha_movimento=False)
    assert d.razao == RAZAO_VARREDURA_PERIODICA


def test_objeto_parado_e_reavaliado_senao_vira_esquecido():
    # 'Parado' sem reavaliação é como a pessoa que foi embora continuar na tela.
    d = _decidir(ultima_revisao_de_parado=90.0, ha_movimento=False)
    assert d.razao == RAZAO_REVER_PARADO


def test_camera_que_se_moveu_tem_prioridade_sobre_tudo():
    # Depois de um giro de PTZ a cena inteira é outra: as posições conhecidas
    # não valem mais nada.
    d = _decidir(camera_se_moveu=True, ha_movimento=True)
    assert d.razao == RAZAO_RECUPERACAO


def test_sem_objeto_parado_a_revisao_nao_dispara():
    # `None` = não há parado nenhum. Não pode virar razão por si só.
    d = _decidir(ultima_revisao_de_parado=None, ha_movimento=False, ultima_varredura=99.9)
    assert d.rodar is False


def test_movimento_vence_varredura_no_ROTULO():
    # A decisão seria a mesma, mas o diagnóstico não: "movimento" é a razão
    # interessante; "varredura" significa que nada acontecia.
    d = _decidir(ha_movimento=True, ultima_varredura=0.0)
    assert d.razao == RAZAO_MOVIMENTO
