"""Adapter fino sobre sv.ByteTrack — comportamento IDÊNTICO ao hardcoded.

Os parâmetros e a semântica são exatamente os que estavam dentro de
ObjectDetector._track_people: track_activation_threshold por classe,
lost_track_buffer, frame_rate arredondado e minimum_consecutive_frames=1.
Qualquer mudança aqui quebra o teste de caracterização — é proposital.

O import do supervision é preguiçoso para que o pacote `trackers` (e os testes
sintéticos do backend "ajustcam") não exijam supervision instalado.
"""
from __future__ import annotations

import numpy as np

from .base import TrackedBox, TrackerBackend


class ByteTrackBackend(TrackerBackend):
    name = "bytetrack"

    def __init__(self, class_id: int, activation_threshold: float,
                 lost_track_buffer: int, frame_rate: int, **kwargs):
        super().__init__(class_id, activation_threshold, lost_track_buffer, frame_rate, **kwargs)
        import supervision as sv  # lazy: ver docstring
        self._sv = sv
        self._tracker = sv.ByteTrack(
            track_activation_threshold=self.activation_threshold,
            lost_track_buffer=self.lost_track_buffer,
            frame_rate=self.frame_rate,
            minimum_consecutive_frames=1,
        )

    def update(self, xyxy: np.ndarray, confidences: np.ndarray, frame=None) -> list[TrackedBox]:
        sv = self._sv
        if xyxy is not None and len(xyxy):
            values = sv.Detections(
                xyxy=np.asarray(xyxy, dtype=np.float32),
                confidence=np.asarray(confidences, dtype=np.float32),
                class_id=np.asarray([self.class_id] * len(xyxy), dtype=int),
            )
        else:
            values = sv.Detections.empty()
        tracked = self._tracker.update_with_detections(values)

        tracker_ids = tracked.tracker_id if tracked.tracker_id is not None else []
        scores = tracked.confidence if tracked.confidence is not None else []
        classes = tracked.class_id if tracked.class_id is not None else []
        output: list[TrackedBox] = []
        for bbox, score, track_id, cls in zip(tracked.xyxy, scores, tracker_ids, classes):
            output.append(
                TrackedBox(
                    bbox=np.asarray(bbox, dtype=np.float32),
                    confidence=float(score),
                    class_id=int(cls) if cls is not None else self.class_id,
                    track_id=int(track_id),
                )
            )
        return output
