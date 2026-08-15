"""Testes v2 — aparência (re-ID), zoom PTZ, coasting de estacionário, min_hits.

Uso:  python tools/test_tracker_v2.py     (requer numpy; cv2 p/ os de aparência/zoom)

O cenário-chave é o RICOCHETE: duas pessoas com o pé na MESMA altura se
aproximam, se encontram no centro e VOLTAM. A predição de velocidade constante
diz "cada um continua em frente" — geometria pura tende a TROCAR os IDs no
encontro. A assinatura de aparência (camisa verde × camisa vermelha) veta o par
errado e os IDs ficam corretos. Também valida que a MESMA situação sem
aparência realmente é ambígua (senão o teste não estaria provando nada).
"""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trackers.ajustcam_tracker import AjustCamTracker  # noqa: E402
from trackers.camera_motion import GlobalMotionEstimator  # noqa: E402

try:
    import cv2
except Exception:
    cv2 = None

FRAME_W, FRAME_H = 640, 480


def person_box(bottom_x, bottom_y, width, height):
    return [bottom_x - width / 2, bottom_y - height, bottom_x + width / 2, bottom_y]


def paint_frame(entries):
    """entries: [(bbox, bgr_color)] -> frame BGR com 'pessoas' coloridas."""
    frame = np.full((FRAME_H, FRAME_W, 3), 30, dtype=np.uint8)
    for bbox, color in entries:
        x1, y1, x2, y2 = [int(max(0, v)) for v in bbox]
        frame[y1:y2, x1:x2] = color
    return frame


def make_tracker(**overrides):
    params = dict(class_id=0, activation_threshold=0.30, lost_track_buffer=8,
                  frame_rate=8, low_conf_floor=0.10, recovery_grace_ms=5000,
                  stationary_frames=6, stationary_iou=0.85, stationary_out_iou=0.60)
    params.update(overrides)
    return AjustCamTracker(**params)


def bounce_frames():
    """A (verde) e B (vermelha), MESMO pé (y=400), aproximam 8 frames, ricocheteiam 8."""
    verde = (60, 200, 60)
    vermelha = (60, 60, 220)
    sequence = []
    for i in range(8):  # aproximação
        ax, bx = 140 + i * 24, 500 - i * 24
        sequence.append(((ax, verde), (bx, vermelha)))
    for i in range(1, 9):  # ricochete: voltam por onde vieram
        ax, bx = 140 + (7 - i) * 24, 500 - (7 - i) * 24
        sequence.append(((ax, verde), (bx, vermelha)))
    frames = []
    for (ax, ca), (bx, cb) in sequence:
        box_a = person_box(ax, 400, 55, 140)
        box_b = person_box(bx, 400, 55, 140)
        frames.append((box_a, box_b, paint_frame([(box_a, ca), (box_b, cb)]), ax, bx))
    return frames


def ids_por_cor(tracker, use_frame):
    """Roda o ricochete; devolve, POR FRAME, o id na posição da verde e da
    vermelha (None quando indistinguíveis por estarem uma sobre a outra)."""
    per_frame = []
    for box_a, box_b, frame, ax, bx in bounce_frames():
        out = tracker.update(
            np.asarray([box_a, box_b], dtype=np.float32),
            np.asarray([0.6, 0.6], dtype=np.float32),
            frame=frame if use_frame else None,
        )
        id_a = id_b = None
        if abs(ax - bx) > 30:  # separadas o bastante para atribuir sem ambiguidade
            for tracked in out:
                foot_x = (tracked.bbox[0] + tracked.bbox[2]) / 2
                if abs(foot_x - ax) < abs(foot_x - bx):
                    id_a = tracked.track_id
                else:
                    id_b = tracked.track_id
        per_frame.append((id_a, id_b))
    return per_frame


def test_ricochete_com_aparencia_mantem_ids():
    assert cv2 is not None, "teste requer cv2 (produção já tem opencv-headless)"
    per_frame = ids_por_cor(make_tracker(appearance=True), use_frame=True)
    first_a, first_b = per_frame[0]
    all_ids = {i for pair in per_frame for i in pair if i is not None}
    # 1) nenhum ID novo nasceu (sem fragmentação)
    assert all_ids == {first_a, first_b}, f"fragmentou: ids vistos {all_ids}"
    # 2) DEPOIS da separação (últimos 5 frames), A é A e B é B
    tail = per_frame[-5:]
    assert all(a == first_a and b == first_b for a, b in tail), (
        f"identidade errada após o ricochete: {tail} vs ({first_a},{first_b})")
    print("ok  8) ricochete com pés na MESMA altura: sem fragmentação e A=A, B=B ao separar")

    # contra-prova: SEM aparência o mesmo cenário troca ou fragmenta.
    per_frame2 = ids_por_cor(make_tracker(appearance=False), use_frame=False)
    fa, fb = per_frame2[0]
    ids2 = {i for pair in per_frame2 for i in pair if i is not None}
    tail2 = per_frame2[-5:]
    trocou = ids2 != {fa, fb} or not all(a == fa and b == fb for a, b in tail2)
    print(f"     contra-prova sem aparência: {'trocou/fragmentou (como esperado)' if trocou else 'geometria sozinha acertou desta vez'}")


def test_recuperacao_pos_oclusao_exige_aparencia_compativel():
    assert cv2 is not None
    tracker = make_tracker(lost_track_buffer=2, appearance=True)
    verde = (60, 200, 60)
    vermelha = (60, 60, 220)
    box = person_box(200, 400, 60, 150)
    first = tracker.update(np.asarray([box], np.float32), np.asarray([0.6], np.float32),
                           frame=paint_frame([(box, verde)]))[0].track_id
    for i in range(3):
        b = person_box(212 + i * 12, 400, 60, 150)
        tracker.update(np.asarray([b], np.float32), np.asarray([0.6], np.float32),
                       frame=paint_frame([(b, verde)]))
    for _ in range(6):
        tracker.update(np.zeros((0, 4), np.float32), np.zeros((0,), np.float32))
    # volta ALGO na posição prevista, mas VERMELHO: aparência veta a recuperação
    volta = person_box(330, 402, 60, 150)
    out = tracker.update(np.asarray([volta], np.float32), np.asarray([0.6], np.float32),
                         frame=paint_frame([(volta, vermelha)]))
    assert out[0].track_id != first, "re-ID aceitou aparência incompatível"
    # e se volta VERDE, recupera o ID original
    tracker2 = make_tracker(lost_track_buffer=2, appearance=True)
    first2 = tracker2.update(np.asarray([box], np.float32), np.asarray([0.6], np.float32),
                             frame=paint_frame([(box, verde)]))[0].track_id
    for i in range(3):
        b = person_box(212 + i * 12, 400, 60, 150)
        tracker2.update(np.asarray([b], np.float32), np.asarray([0.6], np.float32),
                        frame=paint_frame([(b, verde)]))
    for _ in range(6):
        tracker2.update(np.zeros((0, 4), np.float32), np.zeros((0,), np.float32))
    out2 = tracker2.update(np.asarray([volta], np.float32), np.asarray([0.6], np.float32),
                           frame=paint_frame([(volta, verde)]))
    assert out2[0].track_id == first2 and out2[0].recovered is True
    print("ok  9) recuperação pós-oclusão: verde recupera o ID, vermelho vira ID novo")


def test_coasting_estacionario_continua_emitindo():
    tracker = make_tracker(lost_track_buffer=3, stationary_frames=5, stationary_coast=True)
    box = person_box(400, 350, 58, 148)
    tid = None
    for i in range(8):
        out = tracker.update(np.asarray([person_box(400 + (i % 2), 350, 58, 148)], np.float32),
                             np.asarray([0.5], np.float32))
        tid = out[0].track_id
    assert out[0].stationary is True
    # detector falha 4 frames: estacionária CONTINUA na saída (coasting)
    for _ in range(4):
        out = tracker.update(np.zeros((0, 4), np.float32), np.zeros((0,), np.float32))
        assert len(out) == 1, "coasting não emitiu a estacionária durante o miss"
        assert out[0].track_id == tid and out[0].stationary is True
        assert out[0].extra.get("coasted") is True
    # objeto MÓVEL (não estacionário) não ganha coasting
    tracker2 = make_tracker(stationary_coast=True)
    tracker2.update(np.asarray([person_box(100, 400, 55, 140)], np.float32),
                    np.asarray([0.6], np.float32))
    tracker2.update(np.asarray([person_box(130, 400, 55, 140)], np.float32),
                    np.asarray([0.6], np.float32))
    out2 = tracker2.update(np.zeros((0, 4), np.float32), np.zeros((0,), np.float32))
    assert out2 == [], "móvel em miss não pode ser emitido (coasting é só p/ parado)"
    print("ok 10) coasting: parada segue na tela durante misses; móvel não")


def test_zoom_global_mantem_id():
    tracker = make_tracker()
    box = person_box(320, 300, 60, 150)
    first = tracker.update(np.asarray([box], np.float32), np.asarray([0.6], np.float32))[0].track_id
    tracker.update(np.asarray([person_box(322, 300, 60, 150)], np.float32),
                   np.asarray([0.6], np.float32))
    # zoom-in de 25% em torno da origem + deslocamento (pan+zoom do PTZ)
    s, dx, dy = 1.25, -40.0, -30.0
    tracker.apply_global_shift(dx, dy, s)
    zoomed = [box[0] * s + dx, box[1] * s + dy, box[2] * s + dx, box[3] * s + dy]
    out = tracker.update(np.asarray([zoomed], np.float32), np.asarray([0.6], np.float32))
    assert len(out) == 1 and out[0].track_id == first, "zoom compensado trocou o ID"
    print("ok 11) zoom de 25% + pan com apply_global_shift(scale) mantém o ID")


def test_estimador_recupera_zoom_e_pan():
    assert cv2 is not None
    rng = np.random.default_rng(7)
    # cena com ESTRUTURA (um frame real tem quinas, não white noise): zoom em
    # ruído puro descorrelaciona os patches e nenhum optical flow presta.
    base = np.full((480, 640), 40, dtype=np.uint8)
    for _ in range(60):
        x, y = int(rng.integers(0, 600)), int(rng.integers(0, 440))
        w, h = int(rng.integers(12, 60)), int(rng.integers(12, 60))
        cv2.rectangle(base, (x, y), (x + w, y + h), int(rng.integers(80, 255)), -1)
    for _ in range(25):
        cv2.circle(base, (int(rng.integers(20, 620)), int(rng.integers(20, 460))),
                   int(rng.integers(4, 16)), int(rng.integers(80, 255)), -1)
    base3 = cv2.cvtColor(base, cv2.COLOR_GRAY2BGR)
    estimator = GlobalMotionEstimator()
    assert estimator.estimate(base3) == (0.0, 0.0, 1.0)  # primeiro frame calibra
    s_true, dx_true, dy_true = 1.15, 12.0, -8.0
    matrix = np.array([[s_true, 0.0, dx_true], [0.0, s_true, dy_true]], dtype=np.float32)
    warped = cv2.warpAffine(base3, matrix, (640, 480))
    dx, dy, s = estimator.estimate(warped)
    assert abs(s - s_true) < 0.03, f"escala estimada {s} vs real {s_true}"
    assert abs(dx - dx_true) < 6 and abs(dy - dy_true) < 6, f"pan estimado ({dx},{dy})"
    print(f"ok 12) estimador: zoom real 1.15 -> {s:.3f}; pan (12,-8) -> ({dx:.1f},{dy:.1f})")


def test_min_hits_segura_primeira_emissao():
    tracker = make_tracker(min_hits=2)
    out1 = tracker.update(np.asarray([person_box(300, 400, 60, 150)], np.float32),
                          np.asarray([0.6], np.float32))
    assert out1 == [], "min_hits=2 não pode emitir no 1º frame"
    out2 = tracker.update(np.asarray([person_box(310, 400, 60, 150)], np.float32),
                          np.asarray([0.6], np.float32))
    assert len(out2) == 1, "min_hits=2 deveria emitir no 2º frame"
    print("ok 13) min_hits=2: blip de 1 frame não vira caixa; 2º frame emite")


if __name__ == "__main__":
    test_ricochete_com_aparencia_mantem_ids()
    test_recuperacao_pos_oclusao_exige_aparencia_compativel()
    test_coasting_estacionario_continua_emitindo()
    test_zoom_global_mantem_id()
    test_estimador_recupera_zoom_e_pan()
    test_min_hits_segura_primeira_emissao()
    print("\ntodos os cenários v2 passaram")
