"""Bench A/B: bytetrack × ajustcam nos cenários problemáticos das câmeras.

Mede o que o operador PERCEBE: quantos IDs distintos cada objeto real recebeu
(ideal = 1) e quantas trocas de ID ocorreram. Cenários sintéticos determinísticos
que reproduzem os casos medidos: aproximação com escala, confiança oscilando,
oclusão curta e cruzamento.

Também aceita um JSONL gravado das câmeras (um frame por linha):
    {"boxes": [[x1,y1,x2,y2], ...], "scores": [0.5, ...]}
com  --jsonl caminho.jsonl  para comparar nos SEUS vídeos reais.

Uso:  python tools/track_ab_bench.py            # cenários sintéticos
      python tools/track_ab_bench.py --jsonl f.jsonl
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trackers import create_tracker  # noqa: E402

PARAMS = dict(class_id=0, activation_threshold=0.30, lost_track_buffer=8,
              frame_rate=8, low_conf_floor=0.10, recovery_grace_ms=3000,
              stationary_frames=8, stationary_iou=0.85, stationary_out_iou=0.60)


def person_box(bottom_x, bottom_y, width, height):
    return [bottom_x - width / 2, bottom_y - height, bottom_x + width / 2, bottom_y]


def scenario_aproximacao():
    """1 pessoa vem do fundo até perto; confiança cai quando perto (caso real)."""
    frames = []
    truth = []
    for i in range(26):
        h = 55 + i * 8
        w = h * 0.38
        by = 170 + i * 15
        score = 0.55 if i < 16 else (0.20 if i % 2 == 0 else 0.34)
        frames.append(([person_box(320, by, w, h)], [score]))
        truth.append([0])
    return "aproximação + confiança caindo perto", frames, truth


def scenario_oclusao():
    frames = []
    truth = []
    for i in range(6):
        frames.append(([person_box(150 + i * 18, 400, 60, 150)], [0.6])); truth.append([0])
    for _ in range(7):  # atrás do poste
        frames.append(([], [])); truth.append([])
    for i in range(6):
        frames.append(([person_box(300 + i * 18, 402, 62, 152)], [0.6])); truth.append([0])
    return "oclusão de 7 frames", frames, truth


def scenario_cruzamento():
    frames = []
    truth = []
    for i in range(18):
        a = person_box(90 + i * 26, 400, 55, 140)
        b = person_box(560 - i * 26, 428, 60, 152)
        frames.append(([a, b], [0.6, 0.6]))
        truth.append([0, 1])
    return "cruzamento de duas pessoas", frames, truth


def evaluate(name: str, frames, truth):
    print(f"\n--- {name} ---")
    for backend_name in ("bytetrack", "ajustcam"):
        backend = create_tracker(backend_name, **PARAMS)
        ids_per_truth: dict[int, list[int]] = {}
        for (boxes, scores), gt in zip(frames, truth):
            xyxy = np.asarray(boxes, dtype=np.float32).reshape(-1, 4) if boxes else np.zeros((0, 4), np.float32)
            conf = np.asarray(scores, dtype=np.float32) if scores else np.zeros((0,), np.float32)
            out = backend.update(xyxy, conf)
            # associa saída ao ground-truth pelo pé mais próximo (cenários simples)
            for tracked in out:
                foot = ((tracked.bbox[0] + tracked.bbox[2]) / 2, tracked.bbox[3])
                best_gt, best_d = None, 1e9
                for gt_idx, det_idx in enumerate(gt):
                    bx = (boxes[gt_idx][0] + boxes[gt_idx][2]) / 2
                    by = boxes[gt_idx][3]
                    d = abs(foot[0] - bx) + abs(foot[1] - by)
                    if d < best_d:
                        best_gt, best_d = det_idx, d
                if best_gt is None:
                    continue
                ids_per_truth.setdefault(best_gt, [])
                if not ids_per_truth[best_gt] or ids_per_truth[best_gt][-1] != tracked.track_id:
                    ids_per_truth[best_gt].append(tracked.track_id)
        switches = sum(max(0, len(seq) - 1) for seq in ids_per_truth.values())
        unique = {k: len(set(seq)) for k, seq in ids_per_truth.items()}
        print(f"  {backend_name:9s}  ids únicos por objeto: {unique}   trocas de ID: {switches}")


def load_jsonl(path: str):
    frames = []
    truth = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            data = json.loads(line)
            boxes = data.get("boxes") or []
            scores = data.get("scores") or []
            frames.append((boxes, scores))
            truth.append(list(range(len(boxes))))  # sem GT: aproximação por índice
    return "jsonl gravado", frames, truth


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--jsonl", default=None)
    args = parser.parse_args()
    if args.jsonl:
        evaluate(*load_jsonl(args.jsonl))
    else:
        for builder in (scenario_aproximacao, scenario_oclusao, scenario_cruzamento):
            evaluate(*builder())
    print("\nids únicos = 1 e trocas = 0 é o ideal (o operador vê UMA pessoa contínua)")
