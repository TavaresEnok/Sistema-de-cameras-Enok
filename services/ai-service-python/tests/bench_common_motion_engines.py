#!/usr/bin/env python3
"""Benchmark controlado de motores BGS sob o pipeline completo do DRAC.

Somente ``BackgroundSubtractor.apply`` varia. Redimensionamento, compensacao
fotometrica, contraste, blur, sombras, zonas, morfologia, mudanca global,
atividade cronica, piso de ruido, periodicidade, componentes e confirmacao
temporal sao executados pela classe de producao ``MotionDetector``.

O adaptador Frigate preserva o nucleo do ImprovedMotionDetector (media movel,
absdiff, threshold=30 e congelamento inicial de dez quadros com movimento),
mas entrega a mascara antes de dilatacao/contornos para que esses filtros nao
sejam aplicados duas vezes. Portanto ele e identificado como adaptador, nao
como uma execucao byte-a-byte da classe original.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from collections.abc import Callable
from unittest import mock

import cv2
import numpy as np

try:
    from tests.bench_motion_hardening import (
        boxes_overlap,
        events_from_active,
        read_reference_frame,
    )
except ModuleNotFoundError:  # execucao direta: python tests/bench_...py
    from bench_motion_hardening import (
        boxes_overlap,
        events_from_active,
        read_reference_frame,
    )
from detectors.motion import MotionDetector
from runtime_profiles import MOTION_PROFILE


class _ApplyWrapper:
    """Adapta motores sem ``learningRate`` ao contrato OpenCV usado pelo DRAC."""

    def __init__(self, engine):
        self.engine = engine

    def apply(self, frame, learningRate=-1):  # noqa: N803 - API do OpenCV
        del learningRate
        mask = self.engine.apply(frame)
        if isinstance(mask, tuple):
            mask = mask[0]
        return np.asarray(mask, dtype=np.uint8)


class FrigateAverageCore:
    """Nucleo BGS do Frigate ImprovedMotionDetector com saida de mascara.

    O Frigate nao expoe a mascara intermediaria. Esta pequena adaptacao usa a
    mesma media de fundo, absdiff, threshold e regra de aprendizado do fonte
    original. Preprocessamento, dilatacao/contornos e politica de eventos ficam
    deliberadamente fora, pois serao os mesmos filtros DRAC dos demais motores.
    """

    def __init__(self, threshold: int = 30, frame_alpha: float = 0.01):
        self.threshold = int(threshold)
        self.frame_alpha = float(frame_alpha)
        self.avg_frame: np.ndarray | None = None
        self.motion_frame_count = 0

    def apply(self, frame, learningRate=-1):  # noqa: N803 - API do OpenCV
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
        if self.avg_frame is None:
            self.avg_frame = gray.astype(np.float32)
            return np.zeros(gray.shape, dtype=np.uint8)

        delta = cv2.absdiff(gray, cv2.convertScaleAbs(self.avg_frame))
        mask = cv2.threshold(delta, self.threshold, 255, cv2.THRESH_BINARY)[1]
        has_motion = bool(np.count_nonzero(mask))

        # Durante o warm-up, respeita a taxa pedida pelo pipeline comum. Em
        # operacao, preserva a regra Frigate: fundo congela nos dez primeiros
        # quadros ativos e volta a aprender lentamente se a mudanca persistir.
        if learningRate > 0:
            cv2.accumulateWeighted(gray, self.avg_frame, float(learningRate))
            self.motion_frame_count = 0
        elif learningRate == 0:
            pass
        elif has_motion:
            self.motion_frame_count += 1
            if self.motion_frame_count >= 10:
                cv2.accumulateWeighted(gray, self.avg_frame, self.frame_alpha)
        else:
            cv2.accumulateWeighted(gray, self.avg_frame, self.frame_alpha)
            self.motion_frame_count = 0
        return mask


class InjectedMotionDetector(MotionDetector):
    """MotionDetector de producao com um motor de mascara injetado para ensaio."""

    def __init__(self, factory: Callable[[], object], engine_name: str):
        self._benchmark_factory = factory
        self._benchmark_engine_name = engine_name
        super().__init__()

    def _create_background(self, warmup_total: int) -> None:
        # Reutiliza sem copiar toda a rotina de reset dos filtros de producao.
        super()._create_background(warmup_total)
        self.fgbg = self._benchmark_factory()

    def diagnostics(self) -> dict:
        diagnostics = super().diagnostics()
        diagnostics["engine"] = self._benchmark_engine_name
        diagnostics["common_drac_filters"] = True
        return diagnostics


def _pbass_factory():
    import pybgs

    return _ApplyWrapper(pybgs.PixelBasedAdaptiveSegmenter())


def _pybgs_factory(name: str):
    """Motor canônico da BGSLibrary sob o mesmo contrato OpenCV."""
    import pybgs

    return _ApplyWrapper(getattr(pybgs, name)())


class FastSelfTuningBGS:
    """Adaptador da implementação oficial OpenCV de Wang & Dudek (2014)."""

    def __init__(self, native_warmup_frames: int = 60):
        self.engine = None
        self.shape = None
        # O modelo oficial inicia cada pixel como primeiro plano e, a 2 FPS,
        # precisa de ~60 amostras para povoar seus templates. Sem expor esse
        # período ao MotionDetector, a regra DRAC de mudança global reinicia o
        # motor a cada frame e ele nunca termina de calibrar.
        self.native_warmup_frames = int(native_warmup_frames)
        self.frames = 0

    def apply(self, frame, learningRate=-1):  # noqa: N803 - API do OpenCV
        del learningRate  # o algoritmo tem aprendizagem interna própria
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
        if self.engine is None:
            self.shape = gray.shape
            self.engine = cv2.saliency.MotionSaliencyBinWangApr2014_create()
            self.engine.setImagesize(gray.shape[1], gray.shape[0])
            self.engine.init()
        elif gray.shape != self.shape:
            raise ValueError("Fast Self-Tuning BGS exige resolução estável")
        ok, mask = self.engine.computeSaliency(gray)
        self.frames += 1
        if self.frames <= self.native_warmup_frames:
            return np.zeros(gray.shape, dtype=np.uint8)
        if not ok:
            return np.zeros(gray.shape, dtype=np.uint8)
        # A API expõe 1 como primeiro plano e 0 como fundo; normalizamos ao
        # contrato 0/255 antes de os filtros DRAC serem aplicados.
        return np.where(np.asarray(mask) > 0, np.uint8(255), np.uint8(0))


def build_detectors() -> dict[str, MotionDetector]:
    return {
        "mog2_drac_filters": MotionDetector(),
        "knn_drac_filters": InjectedMotionDetector(
            lambda: cv2.createBackgroundSubtractorKNN(
                history=300, dist2Threshold=400.0, detectShadows=True
            ),
            "opencv_knn_drac_filters",
        ),
        "pbas_drac_filters": InjectedMotionDetector(
            _pbass_factory,
            "bgslibrary_pbas_drac_filters",
        ),
        "lobster_drac_filters": InjectedMotionDetector(
            lambda: _pybgs_factory("LOBSTER"),
            "bgslibrary_lobster_drac_filters",
        ),
        "vibe_drac_filters": InjectedMotionDetector(
            lambda: _pybgs_factory("ViBe"),
            "bgslibrary_vibe_drac_filters",
        ),
        "fast_self_tuning_drac_filters": InjectedMotionDetector(
            FastSelfTuningBGS,
            "opencv_fast_self_tuning_wang_dudek_2014_drac_filters",
        ),
        "frigate_core_drac_filters": InjectedMotionDetector(
            lambda: FrigateAverageCore(threshold=30, frame_alpha=0.01),
            "frigate_average_core_adapter_drac_filters",
        ),
    }


def _summarize(
    name: str,
    detector: MotionDetector,
    reference_frames: list[dict],
    fps: float,
    state: dict,
) -> dict:
    processed = len(state["active"])
    refs = reference_frames[:processed]
    semantic_active = [bool(frame.get("moving")) for frame in refs]
    semantic_events = events_from_active(semantic_active, fps, debounce=False)
    product_events = events_from_active(state["active"], fps, debounce=True)

    semantic_details = []
    for start, end in semantic_events:
        detected = any(
            state["confirmed"][index]
            for index in range(start, min(processed, end + 1))
        )
        classes = sorted(
            {
                str(item.get("class") or "object")
                for frame_ref in refs[start : end + 1]
                for item in frame_ref.get("moving", [])
            }
        )
        semantic_details.append(
            {"start": start, "end": end, "detected": detected, "classes": classes}
        )

    confirmed_product = environmental = low_change = 0
    classes_total: dict[str, int] = {}
    for start, end in product_events:
        classes = (
            set().union(*state["confirmed_classes"][start : end + 1])
            if end >= start
            else set()
        )
        if classes:
            confirmed_product += 1
            for label in classes:
                classes_total[label] = classes_total.get(label, 0) + 1
        elif float(np.mean(state["visual_change"][start : end + 1])) >= 0.005:
            environmental += 1
        else:
            low_change += 1

    semantic_detected = sum(bool(event["detected"]) for event in semantic_details)
    timings = state["timings"]
    return {
        "variant": name,
        "frames": processed,
        "duration_s": processed / fps,
        "semantic_events": len(semantic_events),
        "semantic_detected": semantic_detected,
        "semantic_recall": round(semantic_detected / max(1, len(semantic_events)), 4),
        "active_fraction": round(float(np.mean(state["active"])), 4),
        "product_events": len(product_events),
        "confirmed_product_events": confirmed_product,
        "environmental_unconfirmed_events": environmental,
        "low_change_unconfirmed_events": low_change,
        "confirmed_event_precision_proxy": round(
            confirmed_product / max(1, len(product_events)), 4
        ),
        "event_classes": classes_total,
        "missed_semantic_events": [
            event for event in semantic_details if not event["detected"]
        ],
        "ms_frame_median": round(float(np.median(timings)), 4),
        "ms_frame_p95": round(float(np.percentile(timings, 95)), 4),
        "diagnostics": detector.diagnostics(),
    }


def run(video_path: str, reference: dict, max_frames: int | None = None) -> dict:
    fps = float(reference["effective_fps"])
    refs = reference["frames"][: int(reference["sampled_frames"])]
    if max_frames is not None:
        refs = refs[:max_frames]
    profile = {
        "motion_luma_plane": False,
        "motion_scene_change_report": True,
        "motion_photometric_scene_suppression": True,
        "motion_illumination_compensation": True,
    }
    # Os construtores leem o perfil; fixe-o tambem nesta etapa para o resultado
    # nao depender de variaveis de ambiente da maquina que executa o replay.
    with mock.patch.dict(MOTION_PROFILE, profile):
        detectors = build_detectors()
        for detector in detectors.values():
            detector.load()
    states = {
        name: {
            "active": [],
            "confirmed": [],
            "confirmed_classes": [],
            "visual_change": [],
            "timings": [],
        }
        for name in detectors
    }

    capture = cv2.VideoCapture(video_path)
    source_index = -1
    previous_gray = None
    simulated_clock = [0.0]
    processed = 0
    started = time.perf_counter()
    with mock.patch.dict(MOTION_PROFILE, profile), mock.patch(
        "detectors.motion.time.monotonic", side_effect=lambda: simulated_clock[0]
    ):
        for frame_ref in refs:
            target_index = int(frame_ref.get("source_frame", processed))
            frame, source_index = read_reference_frame(capture, source_index, target_index)
            if frame is None:
                break
            simulated_clock[0] = processed / fps
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            change = (
                0.0
                if previous_gray is None
                else float(np.mean(cv2.absdiff(gray, previous_gray) >= 12))
            )
            previous_gray = gray

            for name, detector in detectors.items():
                tick = time.perf_counter()
                detections = detector.infer(frame)
                states[name]["timings"].append(
                    (time.perf_counter() - tick) * 1000.0
                )
                states[name]["active"].append(bool(detections))
                states[name]["visual_change"].append(change)
                classes: set[str] = set()
                for moving in frame_ref.get("moving", []):
                    box = moving.get("box") or []
                    if len(box) == 4 and any(
                        boxes_overlap(detection.bbox, box) for detection in detections
                    ):
                        classes.add(str(moving.get("class") or "object"))
                states[name]["confirmed"].append(bool(classes))
                states[name]["confirmed_classes"].append(classes)
            processed += 1
    capture.release()

    return {
        "schema": 1,
        "video": os.path.basename(video_path),
        "method": {
            "controlled_variable": "background mask engine only",
            "common_pipeline": "production DRAC MotionDetector",
            "same_decoded_frames": True,
            "same_simulated_clock": True,
            "same_product_event_policy": True,
            "semantic_reference": "YOLO moving boxes with spatial overlap",
            "unconfirmed_is_not_automatically_false_positive": True,
            "analysis_resolution": [
                int(MOTION_PROFILE["analysis_width"]),
                int(MOTION_PROFILE["analysis_height"]),
            ],
            "effective_fps": fps,
            "frigate_adapter": (
                "average/absdiff/threshold/10-frame learning core from "
                "ImprovedMotionDetector; DRAC owns every post-filter"
            ),
        },
        "source_provenance": {
            "frigate_file": "concorrentes/frigate/frigate/motion/improved_motion.py",
            "frigate_sha256": hashlib.sha256(
                open(
                    os.environ.get(
                        "FRIGATE_SOURCE",
                        "/frigate/frigate/motion/improved_motion.py",
                    ),
                    "rb",
                ).read()
            ).hexdigest(),
            "pbas": "BGSLibrary pybgs.PixelBasedAdaptiveSegmenter",
            "lobster": "BGSLibrary pybgs.LOBSTER",
            "vibe": "BGSLibrary pybgs.ViBe (classic ViBe, not ViBe+)",
            "fast_self_tuning": "OpenCV MotionSaliencyBinWangApr2014",
            "vibe_plus": "not tested: no canonical implementation available",
            "m4cd": "not tested: no canonical implementation available",
            "knn": "OpenCV createBackgroundSubtractorKNN",
            "mog2": "production DRAC createBackgroundSubtractorMOG2",
        },
        "elapsed_s": round(time.perf_counter() - started, 3),
        "results": [
            _summarize(name, detector, refs, fps, states[name])
            for name, detector in detectors.items()
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-frames", type=int)
    args = parser.parse_args()
    with open(args.reference, encoding="utf-8") as handle:
        reference = json.load(handle)
    payload = run(args.video, reference, args.max_frames)
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
