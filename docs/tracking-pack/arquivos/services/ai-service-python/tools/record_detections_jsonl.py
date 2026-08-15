"""Grava detecções REAIS (do seu modelo, nas suas câmeras) em JSONL p/ o bench.

Fecha o ciclo do track_ab_bench.py: em vez de cenários sintéticos, o A/B
bytetrack × ajustcam roda sobre o que o SEU YOLO viu num vídeo seu.

    # no ambiente do ai-service (com OpenVINO e os modelos montados):
    python tools/record_detections_jsonl.py --video corredor.mp4 --out corredor.jsonl
    python tools/track_ab_bench.py --jsonl corredor.jsonl

Cada linha do JSONL é um frame processado:
    {"t": 12.40, "boxes": [[x1,y1,x2,y2], ...], "scores": [0.61, ...]}

Importante:
  - roda a MESMA cadeia de produção (resize p/ resolução de análise +
    ObjectDetector.infer SEM tracking — context_key=None devolve o cru);
  - respeita GENERAL_DETECTION_FPS por padrão (amostragem igual à produção);
  - por padrão grava só PESSOA (classe 0), que é o que o bench avalia;
  - ESTA FERRAMENTA NÃO FOI EXECUTADA no ambiente de desenvolvimento do pacote
    (não há OpenVINO/modelos aqui) — foi escrita para rodar no seu.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cv2  # noqa: E402

from detectors.object_detector import ObjectDetector  # noqa: E402
from runtime_profiles import GENERAL_PROFILE  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, help="arquivo de vídeo (mp4/mkv/ts)")
    parser.add_argument("--out", required=True, help="JSONL de saída")
    parser.add_argument("--fps", type=float, default=None,
                        help="amostragem; default = GENERAL_DETECTION_FPS")
    parser.add_argument("--class-id", type=int, default=0,
                        help="classe gravada (0=pessoa; -1=todas)")
    args = parser.parse_args()

    capture = cv2.VideoCapture(args.video)
    if not capture.isOpened():
        print(f"não abriu o vídeo: {args.video}")
        return 2
    video_fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    target_fps = float(args.fps or GENERAL_PROFILE.get("detection_fps", 4.0))
    stride = max(1, int(round(video_fps / max(0.1, target_fps))))
    width = int(GENERAL_PROFILE["analysis_width"])
    height = int(GENERAL_PROFILE["analysis_height"])

    detector = ObjectDetector()
    detector.load()

    written = 0
    index = 0
    with open(args.out, "w", encoding="utf-8") as out:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if index % stride != 0:
                index += 1
                continue
            index += 1
            frame = cv2.resize(frame, (width, height))
            # context_key=None => SEM tracking: detecções cruas pós-filtros,
            # exatamente o que os dois trackers receberiam.
            detections = detector.infer(frame, context_key=None)
            boxes = []
            scores = []
            for det in detections:
                cls = int((det.extra or {}).get("classId", -1))
                if args.class_id >= 0 and cls != args.class_id:
                    continue
                boxes.append([int(v) for v in det.bbox])
                scores.append(round(float(det.confidence), 4))
            t = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            out.write(json.dumps({"t": round(t, 2), "boxes": boxes, "scores": scores}) + "\n")
            written += 1
            if written % 100 == 0:
                print(f"{written} frames gravados...")
    capture.release()
    print(f"pronto: {written} frames em {args.out} "
          f"(vídeo {video_fps:.1f} fps, amostrado a ~{video_fps/stride:.1f} fps)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
