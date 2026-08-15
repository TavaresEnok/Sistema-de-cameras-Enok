"""Testes sintéticos do backend "ajustcam" e da associação de piloto.

Rodam SEM supervision/opencv/modelo — só numpy — e cobrem exatamente os casos
problemáticos medidos nas câmeras:

    1. aproximação: pessoa vindo em direção à câmera (escala 3x) mantém 1 ID;
    2. oscilação de confiança: frames fracos (< threshold) NÃO derrubam o ID;
    3. oclusão: 6 frames atrás do poste e o MESMO ID volta (recovered=True);
    4. cruzamento: duas pessoas se cruzam sem trocar de ID (pé separa);
    5. estacionário: pessoa parada vira stationary=True e sobrevive a misses;
    6. compensação global: pan de câmera não troca IDs em bloco;
    7. rider: pessoa fraca sobre moto forte é promovida após confirmação — e
       moto parada com box fantasma de 1 frame NÃO vira pessoa.

Uso:  python tools/test_tracker_synthetic.py
"""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trackers.ajustcam_tracker import AjustCamTracker  # noqa: E402
from trackers.rider_association import RiderAssociator, RiderConfig  # noqa: E402


class FakeDetection:
    def __init__(self, bbox, confidence, class_id, below=False):
        self.bbox = [int(v) for v in bbox]
        self.confidence = float(confidence)
        self.extra = {"classId": int(class_id), "belowThreshold": bool(below)}
        self.label = "pessoa" if class_id == 0 else "veiculo"


def make_tracker(**overrides):
    params = dict(class_id=0, activation_threshold=0.30, lost_track_buffer=8,
                  frame_rate=8, low_conf_floor=0.10, recovery_grace_ms=5000,
                  stationary_frames=8, stationary_iou=0.85, stationary_out_iou=0.60)
    params.update(overrides)
    return AjustCamTracker(**params)


def person_box(bottom_x, bottom_y, width, height):
    return [bottom_x - width / 2, bottom_y - height, bottom_x + width / 2, bottom_y]


def run(tracker, boxes, scores):
    xyxy = np.asarray(boxes, dtype=np.float32).reshape(-1, 4)
    conf = np.asarray(scores, dtype=np.float32).reshape(-1)
    return tracker.update(xyxy, conf)


def test_aproximacao_mantem_id():
    tracker = make_tracker()
    ids = set()
    # pessoa vem do fundo (h=60) até perto (h=190): centro despenca, pé desce suave
    for i in range(20):
        h = 60 + i * 7
        w = h * 0.38
        by = 200 + i * 14
        out = run(tracker, [person_box(320, by, w, h)], [0.55])
        assert len(out) == 1, f"frame {i}: esperava 1 caixa, veio {len(out)}"
        ids.add(out[0].track_id)
    assert len(ids) == 1, f"aproximação trocou de ID: {ids}"
    print("ok  1) aproximação 3x de escala mantém um único ID")


def test_confianca_oscilante_sustenta_id():
    tracker = make_tracker()
    ids = set()
    scores = [0.55, 0.18, 0.14, 0.52, 0.11, 0.49, 0.16, 0.61]  # fracos < 0.30
    for i, score in enumerate(scores):
        out = run(tracker, [person_box(300 + i * 12, 380, 60, 150)], [score])
        for tracked in out:
            ids.add(tracked.track_id)
    assert len(ids) == 1, f"oscilação de confiança trocou ID: {ids}"
    assert tracker.stats["low_conf_matches"] >= 3
    print("ok  2) frames fracos sustentam a trilha (2º estágio) sem criar ID novo")


def test_oclusao_recupera_mesmo_id():
    tracker = make_tracker(lost_track_buffer=2)
    first = run(tracker, [person_box(200, 400, 60, 150)], [0.6])[0].track_id
    for i in range(3):  # ainda anda visível
        run(tracker, [person_box(212 + i * 12, 400, 60, 150)], [0.6])
    for _ in range(6):  # some atrás do poste (nenhuma detecção)
        run(tracker, [], [])
    # reaparece adiante, na direção prevista
    out = run(tracker, [person_box(330, 402, 62, 152)], [0.6])
    assert len(out) == 1
    assert out[0].track_id == first, f"ID não recuperado: {first} -> {out[0].track_id}"
    assert out[0].recovered is True
    assert tracker.stats["recoveries"] >= 1
    print("ok  3) oclusão de 6 frames: mesmo ID volta com recovered=True")


def test_cruzamento_nao_troca_ids():
    tracker = make_tracker()
    # A vai da esquerda p/ direita (pé y=400), B da direita p/ esquerda (pé y=430)
    id_a = id_b = None
    for i in range(16):
        ax = 100 + i * 28
        bx = 540 - i * 28
        out = run(tracker, [person_box(ax, 400, 55, 140), person_box(bx, 430, 60, 155)],
                  [0.6, 0.6])
        assert len(out) == 2
        by_bottom = {round(t.bbox[3]): t.track_id for t in out}
        current_a = by_bottom.get(400)
        current_b = by_bottom.get(430)
        if id_a is None:
            id_a, id_b = current_a, current_b
        else:
            assert current_a == id_a and current_b == id_b, (
                f"cruzamento trocou IDs no frame {i}: {(current_a, current_b)} != {(id_a, id_b)}")
    print("ok  4) cruzamento com pés em alturas distintas não troca IDs")


def test_estacionario_marca_e_tolera_misses():
    tracker = make_tracker(lost_track_buffer=2, stationary_frames=6)
    tid = None
    for i in range(10):  # parada (jitter de 1px)
        out = run(tracker, [person_box(400 + (i % 2), 350, 58, 148)], [0.5])
        tid = out[0].track_id
    assert out[0].stationary is True, "não classificou como estacionária"
    # estacionária ganha 3x o miss budget: 4 misses (>2) não derrubam
    for _ in range(4):
        run(tracker, [], [])
    out = run(tracker, [person_box(400, 350, 58, 148)], [0.5])
    assert out[0].track_id == tid, "estacionária perdeu o ID após misses curtos"
    print("ok  5) parada vira stationary=True e sobrevive a misses do detector")


def test_compensacao_global_pan():
    tracker = make_tracker()
    first = run(tracker, [person_box(300, 400, 60, 150)], [0.6])[0].track_id
    run(tracker, [person_box(305, 400, 60, 150)], [0.6])
    # câmera dá pan: TUDO desloca 90px para a esquerda num frame
    tracker.apply_global_shift(-90.0, 0.0)
    out = run(tracker, [person_box(215, 400, 60, 150)], [0.6])
    assert len(out) == 1 and out[0].track_id == first, "pan compensado trocou o ID"
    print("ok  6) pan de 90px com apply_global_shift mantém o ID")


def test_rider_promove_com_confirmacao_e_bloqueia_fantasma():
    config = RiderConfig(enabled=True, person_floor=0.12, vehicle_min=0.45, confirm_frames=2)
    associator = RiderAssociator(config, person_class_id=0, rider_vehicle_class_ids={1, 3})
    moto = [300, 340, 420, 420]                       # moto forte
    pessoa_montada = [330, 260, 390, 400]             # pé dentro da zona de montaria

    # frame 1: plausível mas ainda sem confirmação -> pessoa NÃO passa
    out1 = associator.apply(
        [FakeDetection(moto, 0.72, 3), FakeDetection(pessoa_montada, 0.19, 0, below=True)],
        person_threshold=0.30)
    assert all((d.extra or {}).get("classId") != 0 for d in out1), "promoveu sem confirmação"

    # frame 2: confirmação atingida -> promovida ao threshold
    out2 = associator.apply(
        [FakeDetection(moto, 0.70, 3), FakeDetection(pessoa_montada, 0.17, 0, below=True)],
        person_threshold=0.30)
    pessoas = [d for d in out2 if (d.extra or {}).get("classId") == 0]
    assert len(pessoas) == 1 and pessoas[0].confidence >= 0.30
    assert pessoas[0].extra.get("riderPromoted") is True
    assert associator.stats["promotions"] == 1

    # fantasma: pessoa fraca LONGE da moto nunca é promovida
    fantasma = [40, 100, 90, 200]
    out3 = associator.apply(
        [FakeDetection(moto, 0.70, 3), FakeDetection(fantasma, 0.20, 0, below=True)],
        person_threshold=0.30)
    assert all((d.extra or {}).get("classId") != 0 for d in out3), "promoveu fantasma fora da moto"
    assert associator.stats["geometry_rejects"] >= 1
    print("ok  7) rider: promove só com geometria plausível + 2 frames; fantasma barrado")


if __name__ == "__main__":
    test_aproximacao_mantem_id()
    test_confianca_oscilante_sustenta_id()
    test_oclusao_recupera_mesmo_id()
    test_cruzamento_nao_troca_ids()
    test_estacionario_marca_e_tolera_misses()
    test_compensacao_global_pan()
    test_rider_promove_com_confirmacao_e_bloqueia_fantasma()
    print("\ntodos os 7 cenários passaram")
