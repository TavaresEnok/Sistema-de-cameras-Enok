#!/usr/bin/env python3
"""Compara motores BGS sem pos-processamento do DRAC.

O ensaio existe para responder uma pergunta especifica: o motor deixou de ver
o objeto ou a mascara dele foi rejeitada por alguma protecao posterior? Somente
resize para 320x180 e a conversao de sombras nativas (127 != foreground) sao
mantidos. A validacao espacial contra a referencia e METRICA de laboratorio,
nao filtro aplicado ao video.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time

import cv2
import numpy as np

try:
    from tests.bench_common_motion_engines import (
        FastSelfTuningBGS,
        FrigateAverageCore,
        _pbass_factory,
        _pybgs_factory,
    )
    from tests.bench_motion_hardening import events_from_active, read_reference_frame
except ModuleNotFoundError:  # execucao direta
    from bench_common_motion_engines import (
        FastSelfTuningBGS,
        FrigateAverageCore,
        _pbass_factory,
        _pybgs_factory,
    )
    from bench_motion_hardening import events_from_active, read_reference_frame


def build_engines() -> dict[str, object]:
    return {
        "mog2_raw": cv2.createBackgroundSubtractorMOG2(
            history=300, varThreshold=40, detectShadows=True
        ),
        "knn_raw": cv2.createBackgroundSubtractorKNN(
            history=300, dist2Threshold=400.0, detectShadows=True
        ),
        "pbas_raw": _pbass_factory(),
        "lobster_raw": _pybgs_factory("LOBSTER"),
        "vibe_raw": _pybgs_factory("ViBe"),
        # Sem mascarar a saída: os 60 frames iniciais serão excluídos apenas
        # da métrica porque a calibração é inerente ao algoritmo, não filtro.
        "fast_self_tuning_raw": FastSelfTuningBGS(native_warmup_frames=0),
        "frigate_core_raw": FrigateAverageCore(threshold=30, frame_alpha=0.01),
    }


def foreground_mask(engine, frame: np.ndarray) -> np.ndarray:
    """Mascara nativa binaria, sem qualquer filtro/politica DRAC."""
    mask = engine.apply(frame)
    if isinstance(mask, tuple):
        mask = mask[0]
    # MOG2/KNN codificam sombra como 127; sombra nao e foreground segundo a
    # propria semantica desses motores, portanto nao a promovemos a movimento.
    return np.where(np.asarray(mask) == 255, np.uint8(255), np.uint8(0))


def reference_classes(mask: np.ndarray, frame_ref: dict, source_w: int, source_h: int) -> set[str]:
    """Avalia sobreposicao; nao altera a mascara e nao filtra o motor."""
    classes: set[str] = set()
    height, width = mask.shape[:2]
    sx, sy = width / float(source_w), height / float(source_h)
    for item in frame_ref.get("moving", []):
        box = item.get("box") or []
        if len(box) != 4:
            continue
        x1, y1, x2, y2 = box
        left, top = max(0, int(x1 * sx)), max(0, int(y1 * sy))
        right, bottom = min(width, int(np.ceil(x2 * sx))), min(height, int(np.ceil(y2 * sy)))
        if right <= left or bottom <= top:
            continue
        region = mask[top:bottom, left:right]
        # Cinco pixels / 0,5% da caixa e somente um criterio de medicao para
        # nao chamar um pixel de compressao de deteccao do objeto inteiro.
        needed = max(5, int((right - left) * (bottom - top) * 0.005))
        if int(np.count_nonzero(region)) >= needed:
            classes.add(str(item.get("class") or "object"))
    return classes


def summarize(name: str, state: dict, refs: list[dict], fps: float, warmup: int) -> dict:
    usable = len(state["classes"])
    refs = refs[:usable]
    semantic = events_from_active([bool(item.get("moving")) for item in refs], fps, debounce=False)
    # A inicializacao e inevitavel em BGS. A coluna principal mede apos os
    # primeiros 30 s (60 quadros a 2 FPS), pois esse e o maior aquecimento
    # nativo entre os motores testados (Fast Self-Tuning). O resultado integral
    # fica registrado.
    def detected(event, after_warmup: bool) -> bool:
        start, end = event
        if after_warmup:
            start = max(start, warmup)
        return start <= end and any(state["classes"][i] for i in range(start, end + 1))

    detected_all = sum(detected(event, False) for event in semantic)
    eligible = [event for event in semantic if event[1] >= warmup]
    detected_stable = sum(detected(event, True) for event in eligible)
    foreground = state["foreground"]
    raw_active = [value > 0 for value in foreground]
    no_reference_active = [raw_active[i] and not bool(refs[i].get("moving")) for i in range(usable)]
    timings = state["timings"]
    return {
        "variant": name,
        "frames": usable,
        "semantic_events_all": len(semantic),
        "semantic_detected_all": detected_all,
        "semantic_events_after_engine_warmup": len(eligible),
        "semantic_detected_after_engine_warmup": detected_stable,
        "semantic_recall_after_engine_warmup": round(detected_stable / max(1, len(eligible)), 4),
        "raw_active_fraction": round(float(np.mean(raw_active)), 4),
        "raw_active_without_reference_fraction": round(float(np.mean(no_reference_active)), 4),
        "raw_foreground_pixel_fraction": round(float(np.mean(foreground)), 6),
        "ms_frame_median": round(float(np.median(timings)), 4),
        "ms_frame_p95": round(float(np.percentile(timings, 95)), 4),
        "missed_semantic_events_after_engine_warmup": [
            {"start": start, "end": end}
            for start, end in eligible
            if not detected((start, end), True)
        ],
    }


def run(video_path: str, reference: dict) -> dict:
    fps = float(reference["effective_fps"])
    refs = reference["frames"][: int(reference["sampled_frames"])]
    engines = build_engines()
    states = {name: {"classes": [], "foreground": [], "timings": []} for name in engines}
    capture = cv2.VideoCapture(video_path)
    source_index = -1
    for frame_ref in refs:
        frame, source_index = read_reference_frame(
            capture, source_index, int(frame_ref.get("source_frame", source_index + 1))
        )
        if frame is None:
            break
        small = cv2.resize(frame, (320, 180))
        for name, engine in engines.items():
            tick = time.perf_counter()
            mask = foreground_mask(engine, small)
            states[name]["timings"].append((time.perf_counter() - tick) * 1000.0)
            states[name]["foreground"].append(float(np.mean(mask > 0)))
            states[name]["classes"].append(
                reference_classes(mask, frame_ref, int(reference["width"]), int(reference["height"]))
            )
    capture.release()
    frigate_path = os.environ.get("FRIGATE_SOURCE", "/frigate/frigate/motion/improved_motion.py")
    return {
        "schema": 1,
        "video": os.path.basename(video_path),
        "method": {
            "drac_post_filters": "disabled",
            "kept": "resize 320x180 and native shadow meaning only",
            "no_illumination": True,
            "no_contrast": True,
            "no_blur": True,
            "no_morphology": True,
            "no_zones": True,
            "no_component_area": True,
            "no_temporal_confirmation": True,
            "no_noise_floor": True,
            "no_chronic_or_periodic_suppression": True,
            "semantic_metric": "raw mask spatial overlap with YOLO moving boxes",
            "warmup_excluded_from_primary_recall_frames": 60,
        },
        "source_provenance": {
            "frigate_sha256": hashlib.sha256(open(frigate_path, "rb").read()).hexdigest(),
            "pbas": "BGSLibrary pybgs.PixelBasedAdaptiveSegmenter",
        },
        "results": [summarize(name, state, refs, fps, 60) for name, state in states.items()],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    with open(args.reference, encoding="utf-8") as handle:
        payload = run(args.video, json.load(handle))
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
