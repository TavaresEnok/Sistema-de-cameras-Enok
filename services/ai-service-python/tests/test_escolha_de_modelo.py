"""A máquina sem placa não pode carregar modelo que ela não aguenta.

Pedido do dono em 15/08/2026, depois de a RTX ser movida de máquina no meio da
noite com `GENERAL_MODEL=yolo26l` ainda no ambiente: "deveria voltar só se
identificar que está sem placa; o próprio sistema volta para yolo26s".
"""

from detectors.escolha_de_modelo import escolher_modelo, peso_do_modelo


def test_com_placa_respeita_o_que_foi_pedido():
    modelo, motivo = escolher_modelo("yolo26l", tem_gpu=True)
    assert modelo == "yolo26l"
    assert motivo is None


def test_o_caso_real_sem_placa_rebaixa_o_pesado():
    # A placa saiu, o ambiente continuou pedindo o modelo grande.
    modelo, motivo = escolher_modelo("yolo26l", tem_gpu=False)
    assert modelo == "yolo26s"
    assert motivo and "sem GPU" in motivo


def test_rebaixamento_NUNCA_e_silencioso():
    # Perder precisão sem avisar é pior que o problema que isso resolve.
    _, motivo = escolher_modelo("yolo26x", tem_gpu=False)
    assert motivo
    assert "GENERAL_MODEL" in motivo, "o motivo precisa dizer como consertar"


def test_modelo_que_cabe_na_cpu_passa_intacto():
    for nome in ("yolo26n", "yolo26s"):
        modelo, motivo = escolher_modelo(nome, tem_gpu=False)
        assert modelo == nome
        assert motivo is None


def test_nunca_PROMOVE_modelo_por_ter_placa():
    # Ter GPU não é razão para trocar a escolha de quem configurou; mudar
    # comportamento sem pedido é o oposto de defesa automática.
    modelo, _ = escolher_modelo("yolo26n", tem_gpu=True)
    assert modelo == "yolo26n"


def test_teto_de_cpu_configuravel():
    modelo, _ = escolher_modelo("yolo26l", tem_gpu=False, teto_de_cpu="yolo26n")
    assert modelo == "yolo26n"


def test_modelo_desconhecido_nao_e_rebaixado_por_engano():
    # Sem saber o peso, quem configurou sabe o que quer. Rebaixar seria
    # trocar o modelo de alguém por adivinhação.
    modelo, motivo = escolher_modelo("modelo-proprio-do-cliente", tem_gpu=False)
    assert modelo == "modelo-proprio-do-cliente"
    assert motivo is None


def test_valor_vazio_cai_no_padrao_em_vez_de_quebrar():
    for vazio in ("", "   ", None):
        modelo, _ = escolher_modelo(vazio, tem_gpu=False)
        assert modelo == "yolo26s"


def test_peso_segue_a_ordem_da_familia():
    assert peso_do_modelo("yolo26n") < peso_do_modelo("yolo26s")
    assert peso_do_modelo("yolo26s") < peso_do_modelo("yolo26l")
    assert peso_do_modelo("yolo26l") < peso_do_modelo("yolo26x")
