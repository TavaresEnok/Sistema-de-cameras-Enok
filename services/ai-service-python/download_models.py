"""
download_models.py — Baixa e valida todos os modelos necessários para /app/models.

Execução:
  python download_models.py

Variáveis de ambiente respeitadas:
  AI_MODELS_DIR    (default /app/models)
Mapeamento de packs:
  buffalo_s → SCRFD-500M (det leve)
  yolo26n_openvino_model → YOLO26n OpenVINO FP32
  yolo26n_int8_{640,512,416}_openvino_model → YOLO26n OpenVINO INT8 fixo
"""
import os
import shutil
from pathlib import Path
from runtime_profiles import FACE_PROFILE


MODELS_DIR = Path(os.getenv("AI_MODELS_DIR", "/app/models"))
MODELS_DIR.mkdir(parents=True, exist_ok=True)


# ──────────────────────────────────────────────────────────────
# InsightFace — packs buffalo (FaceAnalysis)
# ──────────────────────────────────────────────────────────────
def ensure_insightface_pack(pack_name: str) -> None:
    """Garante que um pack buffalo está baixado e inicializável."""
    try:
        from insightface.app import FaceAnalysis
    except ImportError:
        print("[models] insightface não instalado — pulando packs buffalo.")
        return

    det_size = int(FACE_PROFILE["detector_size"])
    app = FaceAnalysis(
        name=pack_name,
        root=str(MODELS_DIR),
        providers=["CPUExecutionProvider"],
    )
    app.prepare(ctx_id=-1, det_size=(det_size, det_size))
    print(f"[models] insightface pack '{pack_name}' OK.")



# ──────────────────────────────────────────────────────────────
# YOLO26n -> exportar para OpenVINO FP32 / INT8
# ──────────────────────────────────────────────────────────────
def _ensure_yolo_export(*, int8: bool, target_name: str, model_name: str = "yolo26n", imgsz: int = 640, data: str | None = None) -> None:
    try:
        from ultralytics import YOLO
    except ImportError:
        print("[models] ultralytics não instalado — pulando YOLO.")
        return

    target = MODELS_DIR / target_name
    source_pt = Path(f"{model_name}.pt")
    if not target.exists() or not any(target.iterdir()):
        precision_label = "INT8" if int8 else "FP32"
        print(f"[models] Exportando {model_name} para OpenVINO {precision_label} {imgsz}x{imgsz}...")
        model = YOLO(str(source_pt))
        export_args = {"format": "openvino", "int8": int8, "imgsz": imgsz}
        if data:
            export_args["data"] = data
        exported = Path(model.export(**export_args))
        if exported.resolve() != target.resolve():
            if target.exists():
                shutil.rmtree(target)
            shutil.move(str(exported), str(target))
    if source_pt.exists():
        source_pt.unlink()
    precision_label = "INT8" if int8 else "FP32"
    print(f"[models] {model_name} OpenVINO {precision_label} {imgsz}x{imgsz} OK.")


def ensure_yolo_fp32() -> None:
    _ensure_yolo_export(int8=False, target_name="yolo26n_openvino_model", model_name="yolo26n")


def ensure_yolo_onnx() -> None:
    """Exporta yolo26n.onnx (com NMS) para o backend CUDA de objetos.

    A saída fica [1,300,6] = [x1,y1,x2,y2,score,cls], IDÊNTICA à do modelo
    OpenVINO — assim o ObjectDetector reusa o mesmo pós-processamento nos dois
    backends. Só o ONNX serve à GPU NVIDIA (OpenVINO GPU é Intel).
    """
    target = MODELS_DIR / "yolo26n.onnx"
    if target.exists() and target.stat().st_size > 0:
        print("[models] yolo26n.onnx OK.")
        return
    try:
        from ultralytics import YOLO
    except ImportError:
        print("[models] ultralytics não instalado — pulando export ONNX.")
        return
    source_pt = Path("yolo26n.pt")
    print("[models] Exportando yolo26n para ONNX (nms=True, 640x640)...")
    model = YOLO(str(source_pt))
    exported = Path(model.export(format="onnx", imgsz=640, nms=True, opset=13))
    if exported.resolve() != target.resolve():
        shutil.move(str(exported), str(target))
    if source_pt.exists():
        source_pt.unlink()
    print("[models] yolo26n.onnx OK.")


def ensure_yolo_int8() -> None:
    # Ultralytics usa quantização pós-treino e requer dataset de calibração.
    # coco8.yaml é leve e atende para gerar artefato INT8 inicial em CPU.
    legacy_640 = MODELS_DIR / "yolo26n_int8_openvino_model"
    explicit_640 = MODELS_DIR / "yolo26n_int8_640_openvino_model"
    if legacy_640.exists() and any(legacy_640.iterdir()) and not explicit_640.exists():
        shutil.copytree(legacy_640, explicit_640)
    for imgsz in (640, 512, 416):
        try:
            _ensure_yolo_export(
                int8=True,
                target_name=f"yolo26n_int8_{imgsz}_openvino_model",
                model_name="yolo26n",
                imgsz=imgsz,
                data="coco8.yaml",
            )
        except Exception as exc:
            print(f"[models] Falha ao exportar YOLO26n INT8 {imgsz}x{imgsz}: {exc}")
            print("[models] Seguindo com variantes já disponíveis.")


def ensure_yolo26s_int8_960() -> None:
    try:
        _ensure_yolo_export(
            int8=True,
            target_name="yolo26s_int8_960_openvino_model",
            model_name="yolo26s",
            imgsz=960,
            data="coco8.yaml",
        )
    except Exception as exc:
        print(f"[models] Falha ao exportar YOLO26s INT8 960x960: {exc}")
        print("[models] O teste agressivo IB-02 requer /app/models/yolo26s_int8_960_openvino_model/yolo26s.xml.")


# ──────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"[models] Diretório: {MODELS_DIR}")

    # Packs buffalo:
    #   buffalo_s → SCRFD-500M det  (leve / CPU)
    for pack in {"buffalo_s"}:
        ensure_insightface_pack(pack)

    # YOLO26n OpenVINO INT8 + FP32 (fallback)
    ensure_yolo_int8()
    ensure_yolo_fp32()
    ensure_yolo26s_int8_960()
    # YOLO26n ONNX (com NMS) — backend CUDA de objetos na GPU NVIDIA.
    ensure_yolo_onnx()

    print("[models] Todos os modelos verificados.")
