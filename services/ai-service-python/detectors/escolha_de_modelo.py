"""ESCOLHER O MODELO QUE A MÁQUINA AGUENTA — sozinho, sem alguém lembrar.

Pedido do dono em 15/08/2026: "deveria voltar só se identificar que está sem
placa; o próprio sistema volta para yolo26s".

O caso que motivou: a RTX foi movida de máquina no meio da noite. O
`GENERAL_MODEL=yolo26l` continuou no ambiente, e o modelo grande — 38,7 ms por
inferência NA PLACA — foi parar no processador, onde é inviável. O sistema não
quebrou (o portão de CUDA cai para CPU em vez de estourar), mas ficou lento
demais para servir, e ninguém foi avisado.

A regra é simples e conservadora: com placa, respeita o que foi pedido; sem
placa, não deixa passar modelo mais pesado do que o teto de CPU. Nunca faz o
contrário — não PROMOVE modelo por achar que há placa sobrando, porque isso
mudaria o comportamento de uma instalação sem ninguém pedir.

Peso relativo dentro da família YOLO (nano → extra-large). O que importa aqui
não é o número exato, é a ORDEM: qualquer modelo acima do teto vira o teto.
"""

PESO_POR_SUFIXO = {"n": 1, "s": 2, "m": 3, "l": 4, "x": 5}

# Sem placa, este é o maior que a CPU serve com dignidade.
#
# Era `yolo26s` até 18/09/2026, escolhido no i9-10850K da matriz ("yolo26s a 960
# mantém 5 câmeras"). O teto estava certo para AQUELA máquina e errado para a
# frota: um servidor de cliente tem ~10 núcleos e divide tudo com gravação e
# live. Medido em 18/09/2026 (8 núcleos, INT8 OpenVINO, mediana de 12
# inferências, TEMPO DE CPU e não de relógio — o modelo usa 7 threads, então o
# cronômetro engana):
#
#   yolo26n @640 →  94 ms de núcleo por quadro → 0,19 núcleo por câmera a 2 fps
#   yolo26s @960 → 578 ms de núcleo por quadro → 1,16 núcleo por câmera a 2 fps
#
# São 6×. Com o nano cabem ~20 câmeras numa máquina de 10 núcleos; com o "s",
# três. Quem tem máquina sobrando levanta o teto em GENERAL_CPU_MODEL_CEILING —
# o padrão precisa ser o que roda em TODO cliente, não o que roda na matriz.
TETO_DE_CPU_PADRAO = "yolo26n"


def peso_do_modelo(nome: str) -> int:
    """Peso relativo pelo sufixo do nome (yolo26l → 4). Desconhecido = mais leve.

    Nome fora do padrão devolve 0 de propósito: modelo que não sabemos medir
    não deve ser rebaixado por engano — quem o configurou sabe o que quer.
    """
    limpo = str(nome or "").strip().lower()
    if not limpo:
        return 0
    return PESO_POR_SUFIXO.get(limpo[-1], 0)


def escolher_modelo(
    pedido: str,
    tem_gpu: bool,
    teto_de_cpu: str = TETO_DE_CPU_PADRAO,
) -> tuple[str, str | None]:
    """Devolve (modelo_a_usar, motivo_do_rebaixamento_ou_None).

    O motivo é texto para log: rebaixamento silencioso é pior que o problema
    que ele resolve — alguém precisa saber por que a precisão caiu.
    """
    escolhido = str(pedido or "").strip() or TETO_DE_CPU_PADRAO
    if tem_gpu:
        return escolhido, None

    peso_pedido = peso_do_modelo(escolhido)
    peso_teto = peso_do_modelo(teto_de_cpu)
    if peso_pedido > peso_teto:
        return (
            teto_de_cpu,
            f"sem GPU: '{escolhido}' é pesado demais para processador; "
            f"usando '{teto_de_cpu}'. Reconecte a placa ou ajuste GENERAL_MODEL.",
        )
    return escolhido, None
