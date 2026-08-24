#!/usr/bin/env python3
"""A/B offline do MOG2 anterior x protecoes fotometricas novas.

Nao e teste unitario (nome `bench_`): recebe video e referencia YOLO externa e
produz JSON. Nenhum stream ou servico de producao e acessado.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from unittest import mock

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from detectors.motion import MotionDetector
from runtime_profiles import MOTION_PROFILE


PIPELINE = dict(k_consecutivos=2, gap_fechar=3, unir_s=5.0, debounce_s=45.0)


def events_from_active(active: list[bool], fps: float, *, debounce: bool = True) -> list[tuple[int, int]]:
    events: list[tuple[int, int]] = []
    run = gap = 0
    start = None
    for index, is_active in enumerate(active):
        if is_active:
            gap = 0
            run += 1
            if start is None and run >= PIPELINE["k_consecutivos"]:
                start = index - PIPELINE["k_consecutivos"] + 1
        else:
            run = 0
            if start is not None:
                gap += 1
                if gap >= PIPELINE["gap_fechar"]:
                    events.append((start, index - gap))
                    start = None
                    gap = 0
    if start is not None:
        events.append((start, len(active) - 1))

    merge_frames = max(1, round(PIPELINE["unir_s"] * fps))
    merged: list[tuple[int, int]] = []
    for event in events:
        if merged and event[0] - merged[-1][1] <= merge_frames:
            merged[-1] = (merged[-1][0], event[1])
        else:
            merged.append(event)
    if not debounce:
        return merged

    debounce_frames = max(1, round(PIPELINE["debounce_s"] * fps))
    product: list[tuple[int, int]] = []
    last_start = None
    for event in merged:
        if last_start is None or event[0] - last_start >= debounce_frames:
            product.append(event)
            last_start = event[0]
    return product


def boxes_overlap(a: list[int], b: list[float]) -> bool:
    return min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])


def read_reference_frame(capture, source_index: int, target_index: int):
    """Avanca o video bruto ate o quadro que gerou a referencia semantica.

    A referencia e criada a 2 FPS a partir de uma fonte geralmente a 30 FPS.
    Ler simplesmente um quadro por referencia compara os primeiros dois minutos
    do video com rotulos distribuidos pelos trinta minutos inteiros. Este helper
    preserva a mesma amostragem usada pelo ``semantic_reference.py``.
    """
    frame = None
    while source_index < target_index:
        ok, frame = capture.read()
        if not ok:
            return None, source_index
        source_index += 1
    return frame, source_index


def run_variant(video_path: str, reference_frames, fps: float, profile: dict, name: str) -> dict:
    active: list[bool] = []
    confirmed: list[bool] = []
    confirmed_classes: list[set[str]] = []
    visual_change: list[float] = []
    timings: list[float] = []
    photometric_frames: list[int] = []
    suppressed_photometric_frames: list[int] = []
    illumination_candidates: list[dict] = []
    previous_gray = None
    processed = 0
    simulated_clock = [0.0]

    # Periodicidade usa monotonic() em produção. No replay acelerado, usar o
    # relógio da CPU faria a variante mais lenta enxergar intervalos diferentes.
    # Fixamos o tempo no timestamp do vídeo para um A/B determinístico.
    with mock.patch.dict(MOTION_PROFILE, profile), mock.patch(
        "detectors.motion.time.monotonic", side_effect=lambda: simulated_clock[0]
    ):
        detector = MotionDetector()
        detector.load()
        started = time.perf_counter()
        capture = cv2.VideoCapture(video_path)
        source_index = -1
        for frame_ref in reference_frames:
            target_index = int(frame_ref.get("source_frame", processed))
            frame, source_index = read_reference_frame(capture, source_index, target_index)
            if frame is None:
                break
            processed += 1
            simulated_clock[0] = (processed - 1) / fps
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            visual_change.append(
                0.0 if previous_gray is None else float(np.mean(cv2.absdiff(gray, previous_gray) >= 12))
            )
            previous_gray = gray

            tick = time.perf_counter()
            detections = detector.infer(frame)
            timings.append((time.perf_counter() - tick) * 1000.0)
            if detector._last_illumination.photometric:
                photometric_frames.append(processed - 1)
            illumination = detector._last_illumination
            if abs(float(illumination.offset)) >= 4.0:
                illumination_candidates.append({
                    "frame": processed - 1,
                    "offset": illumination.offset,
                    "changed_ratio": illumination.changed_ratio,
                    "uniform_ratio": illumination.uniform_ratio,
                    "block_uniform_ratio": illumination.block_uniform_ratio,
                    "photometric": illumination.photometric,
                })
            if detector._last_suppression_reason == "photometric_scene_change":
                suppressed_photometric_frames.append(processed - 1)
            active.append(bool(detections))
            classes: set[str] = set()
            for moving in frame_ref.get("moving", []):
                box = moving.get("box") or []
                if len(box) == 4 and any(boxes_overlap(d.bbox, box) for d in detections):
                    classes.add(str(moving.get("class") or "object"))
            confirmed.append(bool(classes))
            confirmed_classes.append(classes)
        capture.release()
        elapsed = time.perf_counter() - started
        diagnostics = detector.diagnostics()

    semantic_active = [bool(frame.get("moving")) for frame in reference_frames]
    semantic_events = events_from_active(semantic_active, fps, debounce=False)
    product_events = events_from_active(active, fps, debounce=True)
    semantic_details = []
    for start, end in semantic_events:
        detected = any(confirmed[i] for i in range(start, min(len(confirmed), end + 1)))
        classes = sorted({
            str(item.get("class") or "object")
            for frame_ref in reference_frames[start:end + 1]
            for item in frame_ref.get("moving", [])
        })
        semantic_details.append({"start": start, "end": end, "detected": detected, "classes": classes})
    semantic_detected = sum(bool(event["detected"]) for event in semantic_details)
    product_confirmed = environmental = low_change = 0
    classes_total: dict[str, int] = {}
    for start, end in product_events:
        classes = set().union(*confirmed_classes[start:end + 1]) if end >= start else set()
        if classes:
            product_confirmed += 1
            for label in classes:
                classes_total[label] = classes_total.get(label, 0) + 1
        elif float(np.mean(visual_change[start:end + 1])) >= 0.005:
            environmental += 1
        else:
            low_change += 1

    return {
        "variant": name,
        "frames": processed,
        "duration_s": processed / fps,
        "semantic_events": len(semantic_events),
        "semantic_detected": semantic_detected,
        "semantic_recall": round(semantic_detected / max(1, len(semantic_events)), 4),
        "active_fraction": round(float(np.mean(active)), 4),
        "product_events": len(product_events),
        "confirmed_product_events": product_confirmed,
        "environmental_unconfirmed_events": environmental,
        "low_change_unconfirmed_events": low_change,
        "confirmed_event_precision_proxy": round(product_confirmed / max(1, len(product_events)), 4),
        "event_classes": classes_total,
        "missed_semantic_events": [event for event in semantic_details if not event["detected"]],
        "photometric_frames": photometric_frames,
        "suppressed_photometric_frames": suppressed_photometric_frames,
        "illumination_candidates": sorted(
            illumination_candidates,
            key=lambda item: abs(float(item["offset"])),
            reverse=True,
        )[:20],
        "illumination_candidate_frames": len(illumination_candidates),
        "ms_frame_median": round(float(np.median(timings)), 4),
        "ms_frame_p95": round(float(np.percentile(timings, 95)), 4),
        "elapsed_s": round(elapsed, 3),
        "diagnostics": diagnostics,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    with open(args.reference, encoding="utf-8") as handle:
        reference = json.load(handle)
    expected = int(reference["sampled_frames"])
    refs = reference["frames"][:expected]
    fps = float(reference["effective_fps"])

    common = {
        "motion_luma_plane": False,
        "motion_scene_change_report": True,
        "motion_photometric_scene_suppression": True,
    }
    results = [
        run_variant(
            args.video,
            refs,
            fps,
            {**common, "motion_illumination_compensation": False},
            "mog2_before_photometric_guard",
        ),
        run_variant(
            args.video,
            refs,
            fps,
            {**common, "motion_illumination_compensation": True},
            "mog2_hardened",
        ),
    ]
    payload = {
        "schema": 1,
        "video": os.path.basename(args.video),
        "reference": os.path.basename(args.reference),
        "method": "production MotionDetector + YOLO moving boxes + product event policy",
        "results": results,
    }
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
