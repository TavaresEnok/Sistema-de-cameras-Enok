"""Caracterização: ByteTrackBackend ≡ sv.ByteTrack hardcoded (código antigo).

Alimenta a MESMA sequência de detecções (aproximação, oscilação de confiança,
gaps, dois objetos) no sv.ByteTrack configurado exatamente como estava dentro
de ObjectDetector._track_people e no adapter novo. Qualquer divergência de id,
caixa ou confiança falha o teste — trocar para o registro NÃO muda produção.

Uso:  python tools/test_bytetrack_characterization.py
Requer supervision instalado (mesma dependência que produção já tem).
"""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import supervision as sv  # noqa: E402
from trackers.bytetrack_backend import ByteTrackBackend  # noqa: E402

ACTIVATION = 0.30
BUFFER = 20
FPS = 4
CLASS_ID = 0


def scenario():
    """Sequência determinística com os casos chatos: escala, fraco, gap, 2 objetos."""
    frames = []
    for i in range(12):  # aproximação
        h = 60 + i * 9
        w = h * 0.4
        by = 180 + i * 16
        frames.append(([[320 - w / 2, by - h, 320 + w / 2, by]], [0.55]))
    frames.append(([], []))  # gap
    frames.append(([], []))
    for i in range(8):  # dois objetos + confiança oscilando
        frames.append((
            [[100 + i * 20, 240, 160 + i * 20, 380],
             [500 - i * 18, 260, 555 - i * 18, 410]],
            [0.5 if i % 2 == 0 else 0.22, 0.6],
        ))
    return frames


def run_old(frames):
    tracker = sv.ByteTrack(
        track_activation_threshold=ACTIVATION,
        lost_track_buffer=BUFFER,
        frame_rate=FPS,
        minimum_consecutive_frames=1,
    )
    outputs = []
    for boxes, scores in frames:
        if boxes:
            values = sv.Detections(
                xyxy=np.asarray(boxes, dtype=np.float32),
                confidence=np.asarray(scores, dtype=np.float32),
                class_id=np.asarray([CLASS_ID] * len(boxes), dtype=int),
            )
        else:
            values = sv.Detections.empty()
        tracked = tracker.update_with_detections(values)
        ids = tracked.tracker_id if tracked.tracker_id is not None else []
        confs = tracked.confidence if tracked.confidence is not None else []
        frame_out = sorted(
            (int(t), [round(float(v), 3) for v in b.tolist()], round(float(c), 4))
            for b, c, t in zip(tracked.xyxy, confs, ids)
        )
        outputs.append(frame_out)
    return outputs


def run_new(frames):
    backend = ByteTrackBackend(
        class_id=CLASS_ID, activation_threshold=ACTIVATION,
        lost_track_buffer=BUFFER, frame_rate=FPS,
        # kwargs extras que o detector passa para o backend "ajustcam" devem
        # ser IGNORADOS aqui sem efeito colateral:
        low_conf_floor=0.10, recovery_grace_ms=2000,
        stationary_frames=10, stationary_iou=0.88, stationary_out_iou=0.70,
    )
    outputs = []
    for boxes, scores in frames:
        xyxy = np.asarray(boxes, dtype=np.float32).reshape(-1, 4) if boxes else np.zeros((0, 4), np.float32)
        conf = np.asarray(scores, dtype=np.float32) if scores else np.zeros((0,), np.float32)
        tracked = backend.update(xyxy, conf)
        frame_out = sorted(
            (int(t.track_id), [round(float(v), 3) for v in t.bbox.tolist()], round(float(t.confidence), 4))
            for t in tracked
        )
        outputs.append(frame_out)
    return outputs


if __name__ == "__main__":
    frames = scenario()
    old = run_old(frames)
    new = run_new(frames)
    for idx, (a, b) in enumerate(zip(old, new)):
        assert a == b, f"divergência no frame {idx}:\n  antigo: {a}\n  novo:   {b}"
    total = sum(len(f) for f in old)
    print(f"caracterização OK: {len(frames)} frames, {total} caixas — adapter ≡ hardcoded")
