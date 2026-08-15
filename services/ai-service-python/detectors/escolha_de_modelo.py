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

# Sem placa, este é o maior que a CPU serve com dignidade. Medido em 14/08/2026
# no i9-10850K: yolo26s a 960 mantém 5 câmeras; yolo26l não fecha a conta nem na
# GPU antiga (26 inferências/s contra 40 pedidas).
TETO_DE_CPU_PADRAO = "yolo26s"


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
