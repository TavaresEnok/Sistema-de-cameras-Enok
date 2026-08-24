#!/usr/bin/env python3
"""Offline benchmark of Frigate's unmodified ImprovedMotionDetector.

The Frigate source is mounted read-only. Small runtime shims provide only the
configuration and utility symbols needed to execute the original detector;
motion logic is never copied into this repository.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
import time
import types
from dataclasses import dataclass

import cv2
import numpy as np

from bench_motion_hardening import PIPELINE, boxes_overlap, events_from_active, read_reference_frame


def load_frigate_improved_detector(frigate_root: str):
    """Load Frigate's source file unchanged with its minimal runtime contract."""
    source_path = os.path.join(frigate_root, "frigate", "motion", "improved_motion.py")
    if not os.path.isfile(source_path):
        raise FileNotFoundError(f"Frigate ImprovedMotionDetector not found: {source_path}")

    frigate = types.ModuleType("frigate")
    camera = types.ModuleType("frigate.camera")
    config = types.ModuleType("frigate.config")
    config_config = types.ModuleType("frigate.config.config")
    motion = types.ModuleType("frigate.motion")
    util = types.ModuleType("frigate.util")
    util_image = types.ModuleType("frigate.util.image")

    class PTZMetrics:  # pragma: no cover - only used for Frigate type annotation.
        pass

    class MotionDetector:
        pass

    def grab_cv2_contours(contours):
        return contours[0] if len(contours) == 2 else contours[1]

    camera.PTZMetrics = PTZMetrics
    config_config.RuntimeMotionConfig = object
    motion.MotionDetector = MotionDetector
    util_image.grab_cv2_contours = grab_cv2_contours
    sys.modules.update(
        {
            "frigate": frigate,
            "frigate.camera": camera,
            "frigate.config": config,
            "frigate.config.config": config_config,
            "frigate.motion": motion,
            "frigate.util": util,
            "frigate.util.image": util_image,
        }
    )

    spec = importlib.util.spec_from_file_location("frigate.motion.improved_motion", source_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load Frigate ImprovedMotionDetector")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    digest = hashlib.sha256(open(source_path, "rb").read()).hexdigest()
    return module.ImprovedMotionDetector, source_path, digest


@dataclass
class FrigateMotionConfig:
    """MotionConfig values required by Frigate's ImprovedMotionDetector."""

    frame_shape: tuple[int, int]
    enabled: bool = True
    threshold: int = 30
    lightning_threshold: float = 0.8
    skip_motion_threshold: float | None = None
    improve_contrast: bool = True
    contour_area: int = 10
    delta_alpha: float = 0.2
    frame_alpha: float = 0.01
    frame_height: int = 100

    def __post_init__(self) -> None:
        self.rasterized_mask = np.full(self.frame_shape, 255, dtype=np.uint8)


def run_frigate(
    video_path: str,
    reference_frames: list[dict],
    fps: float,
    frigate_root: str,
    *,
    threshold: int,
    contour_area: int,
    frame_height: int,
    skip_motion_threshold: float | None,
) -> dict:
    detector_class, source_path, source_digest = load_frigate_improved_detector(frigate_root)
    capture = cv2.VideoCapture(video_path)
    active: list[bool] = []
    confirmed: list[bool] = []
    confirmed_classes: list[set[str]] = []
    visual_change: list[float] = []
    timings: list[float] = []
    processed = 0
    source_index = -1
    previous_gray = None
    config = None
    detector = None
    calibrating_frames = raw_box_frames = 0
    started = time.perf_counter()

    for frame_ref in reference_frames:
        target_index = int(frame_ref.get("source_frame", processed))
        frame, source_index = read_reference_frame(capture, source_index, target_index)
        if frame is None:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if detector is None:
            config = FrigateMotionConfig(
                gray.shape,
                threshold=threshold,
                contour_area=contour_area,
                frame_height=frame_height,
                skip_motion_threshold=skip_motion_threshold,
            )
            detector = detector_class(gray.shape, config, fps=max(1, int(round(fps))))
        visual_change.append(
            0.0 if previous_gray is None else float(np.mean(cv2.absdiff(gray, previous_gray) >= 12))
        )
        previous_gray = gray

        tick = time.perf_counter()
        boxes = detector.detect(gray)
        timings.append((time.perf_counter() - tick) * 1000.0)
        calibrating = bool(detector.is_calibrating())
        if calibrating:
            calibrating_frames += 1
        if boxes:
            raw_box_frames += 1
        # Frigate's process_frames only uses standalone motion boxes after the
        # detector leaves calibration; preserve that production behavior.
        detections = [] if calibrating else boxes
        active.append(bool(detections))
        classes: set[str] = set()
        for moving in frame_ref.get("moving", []):
            box = moving.get("box") or []
            if len(box) == 4 and any(boxes_overlap(detection, box) for detection in detections):
                classes.add(str(moving.get("class") or "object"))
        confirmed.append(bool(classes))
        confirmed_classes.append(classes)
        processed += 1
    capture.release()

    semantic_active = [bool(frame.get("moving")) for frame in reference_frames[:processed]]
    semantic_events = events_from_active(semantic_active, fps, debounce=False)
    product_events = events_from_active(active, fps, debounce=True)
    semantic_details = []
    for start, end in semantic_events:
        detected = any(confirmed[index] for index in range(start, min(len(confirmed), end + 1)))
        classes = sorted(
            {
                str(item.get("class") or "object")
                for frame_ref in reference_frames[start : end + 1]
                for item in frame_ref.get("moving", [])
            }
        )
        semantic_details.append({"start": start, "end": end, "detected": detected, "classes": classes})

    product_confirmed = environmental = low_change = 0
    classes_total: dict[str, int] = {}
    for start, end in product_events:
        classes = set().union(*confirmed_classes[start : end + 1]) if end >= start else set()
        if classes:
            product_confirmed += 1
            for label in classes:
                classes_total[label] = classes_total.get(label, 0) + 1
        elif float(np.mean(visual_change[start : end + 1])) >= 0.005:
            environmental += 1
        else:
            low_change += 1

    return {
        "variant": (
            "frigate_improved_motion_stock"
            if (threshold, contour_area, frame_height, skip_motion_threshold) == (30, 10, 100, None)
            else "frigate_improved_motion_tuned"
        ),
        "source": {"path": source_path, "sha256": source_digest},
        "frames": processed,
        "duration_s": processed / fps,
        "semantic_events": len(semantic_events),
        "semantic_detected": sum(bool(event["detected"]) for event in semantic_details),
        "semantic_recall": round(
            sum(bool(event["detected"]) for event in semantic_details) / max(1, len(semantic_details)), 4
        ),
        "active_fraction": round(float(np.mean(active)), 4) if active else 0.0,
        "product_events": len(product_events),
        "confirmed_product_events": product_confirmed,
        "environmental_unconfirmed_events": environmental,
        "low_change_unconfirmed_events": low_change,
        "confirmed_event_precision_proxy": round(product_confirmed / max(1, len(product_events)), 4),
        "event_classes": classes_total,
        "missed_semantic_events": [event for event in semantic_details if not event["detected"]],
        "ms_frame_median": round(float(np.median(timings)), 4) if timings else None,
        "ms_frame_p95": round(float(np.percentile(timings, 95)), 4) if timings else None,
        "elapsed_s": round(time.perf_counter() - started, 3),
        "diagnostics": {
            "config": {
                "frame_height": config.frame_height if config else None,
                "threshold": config.threshold if config else None,
                "contour_area": config.contour_area if config else None,
                "improve_contrast": config.improve_contrast if config else None,
                "frame_alpha": config.frame_alpha if config else None,
                "lightning_threshold": config.lightning_threshold if config else None,
                "skip_motion_threshold": config.skip_motion_threshold if config else None,
            },
            "calibrating_frames": calibrating_frames,
            "raw_box_frames": raw_box_frames,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--frigate-root", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--threshold", type=int, default=30)
    parser.add_argument("--contour-area", type=int, default=10)
    parser.add_argument("--frame-height", type=int, default=100)
    parser.add_argument("--skip-motion-threshold", type=float)
    args = parser.parse_args()
    with open(args.reference, encoding="utf-8") as handle:
        reference = json.load(handle)
    refs = reference["frames"][: int(reference["sampled_frames"])]
    result = run_frigate(
        args.video,
        refs,
        float(reference["effective_fps"]),
        args.frigate_root,
        threshold=args.threshold,
        contour_area=args.contour_area,
        frame_height=args.frame_height,
        skip_motion_threshold=args.skip_motion_threshold,
    )
    payload = {
        "schema": 1,
        "video": os.path.basename(args.video),
        "reference": os.path.basename(args.reference),
        "method": "unmodified Frigate ImprovedMotionDetector + same YOLO motion reference + product event policy",
        "result": result,
    }
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
