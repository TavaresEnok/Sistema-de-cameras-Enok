"""Banco de provas do detector de movimento: RUÍDO × OBJETO REAL.

Existe porque afinar detecção de movimento "no olho" é enganoso: qualquer ajuste
que reduz falso positivo também mata objeto real se for longe demais, e o efeito
só aparece em produção — na forma de gravação perdida.

O banco mede as DUAS coisas ao mesmo tempo, na mesma configuração:

  FALSO POSITIVO — cena PARADA com ruído de sensor (o que existe de verdade em
                   câmera à noite/ganho alto). Qualquer detecção aqui é erro:
                   é gravação que o cliente paga em disco sem nada acontecer.

  VERDADEIRO POSITIVO — objeto de BAIXO CONTRASTE se movendo (pessoa de roupa
                   escura ao entardecer é o caso difícil que importa). Não
                   detectar aqui é o defeito grave: a câmera deixa de gravar
                   exatamente quando devia.

Um ajuste só é aceitável quando derruba o primeiro SEM tocar no segundo.

Uso:  docker exec -i vms-ai-service python3 - < tests/bench_motion_ruido.py
"""
import sys
import numpy as np

sys.path.insert(0, "/app")
import cv2  # noqa: E402
from detectors.motion import MotionDetector  # noqa: E402

ALTURA, LARGURA = 360, 640
QUADROS_RUIDO = 120
SEMENTE = 20260811


def cena_base(rng, sigma):
    """Fundo estático com textura — nunca cor chapada.

    Cor chapada é o teste fácil: o MOG2 converge para variância ~0 e qualquer
    coisa dispara. Textura (como asfalto/parede real) é o que ele enfrenta.
    """
    base = np.full((ALTURA, LARGURA, 3), 90, dtype=np.float32)
    yy, xx = np.mgrid[0:ALTURA, 0:LARGURA]
    base += (18 * np.sin(xx / 9.0) + 12 * np.cos(yy / 7.0))[..., None]
    return base


def com_ruido(base, rng, sigma):
    return np.clip(base + rng.normal(0, sigma, base.shape), 0, 255).astype(np.uint8)


def medir(construir_detector, sigma, delta_objeto):
    """Devolve (falsos_positivos, detectou_objeto) para uma configuração."""
    rng = np.random.default_rng(SEMENTE)
    det = construir_detector()
    det.load()
    base = cena_base(rng, sigma)

    # Aquecimento: o detector aprende o fundo COM o ruído presente.
    for _ in range(60):
        det.infer(com_ruido(base, rng, sigma))

    # 1) Cena parada: tudo que sair aqui é falso positivo.
    falsos = 0
    for _ in range(QUADROS_RUIDO):
        if det.infer(com_ruido(base, rng, sigma)):
            falsos += 1

    # 2) Objeto real de baixo contraste atravessando a cena.
    detectou = False
    for passo in range(6):
        quadro = com_ruido(base, rng, sigma)
        x = 150 + passo * 26
        # ~46x92 px: pessoa a média distância no quadro de análise.
        quadro[150:242, x:x + 46] = np.clip(
            quadro[150:242, x:x + 46].astype(np.int16) + delta_objeto, 0, 255
        ).astype(np.uint8)
        if det.infer(quadro):
            detectou = True
    return falsos, detectou


def cenarios():
    """(nome, fábrica) — a fábrica devolve um detector recém-criado."""
    def base():
        return MotionDetector()

    def com_blur(k):
        def fabricar():
            d = MotionDetector()
            d._blur_ksize = k
            return d
        return fabricar

    return [("sem blur", com_blur(0)), ("blur 3x3", com_blur(3)), ("blur 5x5", com_blur(5))]


if __name__ == "__main__":
    print(f"{'configuração':22} {'sigma':>6} {'falsos/120':>11} {'objeto real':>12}")
    print("-" * 56)
    for nome, fabricar in cenarios():
        for sigma in (3, 6, 10):
            falsos, detectou = medir(fabricar, sigma, delta_objeto=14)
            marca = "OK" if detectou else "PERDEU!"
            print(f"{nome:22} {sigma:>6} {falsos:>11} {marca:>12}")


# ── O OUTRO LADO DA MOEDA: o blur custa SENSIBILIDADE? ──────────────────────
# Reduzir falso positivo é fácil — basta cegar o detector. O que torna um ajuste
# ACEITÁVEL é não perder objeto real. Aqui varremos objeto por TAMANHO (pessoa
# perto → pessoa longe) e por CONTRASTE (roupa clara → roupa escura ao
# entardecer), com ruído moderado, e comparamos sem blur × com blur.

def objeto_detectado(fabricar, sigma, largura_obj, altura_obj, delta):
    rng = np.random.default_rng(SEMENTE)
    det = fabricar(); det.load()
    base = cena_base(rng, sigma)
    for _ in range(60):
        det.infer(com_ruido(base, rng, sigma))
    for passo in range(6):
        quadro = com_ruido(base, rng, sigma)
        x = 150 + passo * 26
        alvo = quadro[150:150 + altura_obj, x:x + largura_obj].astype(np.int16)
        quadro[150:150 + altura_obj, x:x + largura_obj] = np.clip(alvo + delta, 0, 255).astype(np.uint8)
        if det.infer(quadro):
            return True
    return False


def varredura_sensibilidade():
    from functools import partial
    def fab(k):
        def f():
            d = MotionDetector(); d._blur_ksize = k; return d
        return f

    casos = [
        ("pessoa perto",   46, 92, 14),
        ("pessoa media",   30, 60, 14),
        ("pessoa longe",   18, 36, 14),
        ("baixo contraste",46, 92,  7),
        ("muito fraco",    30, 60,  5),
    ]
    print()
    print(f"{'objeto':18} {'sem blur':>10} {'blur 3x3':>10} {'blur 5x5':>10}")
    print("-" * 52)
    for nome, w, h, d in casos:
        linha = []
        for k in (0, 3, 5):
            ok = objeto_detectado(fab(k), sigma=6, largura_obj=w, altura_obj=h, delta=d)
            linha.append("detecta" if ok else "PERDEU")
        print(f"{nome:18} {linha[0]:>10} {linha[1]:>10} {linha[2]:>10}")


if __name__ == "__main__":
    varredura_sensibilidade()
