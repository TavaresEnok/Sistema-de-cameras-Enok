"""Associação de piloto — dá vida ao `riderVehicleProxy` (hoje campo morto).

Problema real: moto/bicicleta passa, o YOLO acerta o veículo com folga mas a
PESSOA em cima sai com confiança abaixo do threshold (pose sentada, oclusão
pelas próprias pernas/guidão). Resultado: evento de "moto" sem "pessoa", e
patinete (sem classe própria no COCO) só aparece quando classificado como
bicicleta/moto.

Regra: pessoa FRACA (>= floor, < threshold normal) geometricamente montada em
veículo de piloto FORTE, confirmada em N frames seguidos, é PROMOVIDA — a
confiança sobe até o threshold para que o tracker a aceite. NUNCA se inventa
caixa: só se promove o que o YOLO realmente produziu.

Isto NÃO é comportamento portado do Frigate — o Frigate atual não tem essa
regra nativa (há pedido aberto para o inverso: suprimir a pessoa sobreposta).
É heurística própria do AjustCam, por isso as proteções são agressivas:

    - veículo precisa de confiança >= vehicle_min (default 0.45);
    - pessoa precisa de confiança >= person_floor (default 0.12);
    - geometria plausível: pé da pessoa dentro da faixa vertical do veículo
      (com folga), sobreposição horizontal real, pessoa não gigante em relação
      ao veículo;
    - confirmação em `confirm_frames` frames consecutivos por região do
      veículo — moto estacionada + sombra não vira pessoa num frame isolado;
    - feature flag (GENERAL_RIDER_ASSOCIATION, default OFF) e contadores
      próprios para auditoria em /status.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class RiderConfig:
    enabled: bool = False
    person_floor: float = 0.12
    vehicle_min: float = 0.45
    confirm_frames: int = 2
    # geometria
    horizontal_overlap_min: float = 0.30   # fração da LARGURA da pessoa sobre o veículo
    max_person_vehicle_height_ratio: float = 2.4
    foot_zone_top: float = 0.35            # pé da pessoa abaixo de 35% da altura do veículo
    foot_zone_bottom_slack: float = 0.15   # ...e até 15% abaixo da base do veículo


class RiderAssociator:
    """Um por câmera (context_key). Mantém memória curta para a confirmação."""

    def __init__(self, config: RiderConfig, person_class_id: int, rider_vehicle_class_ids: set[int]):
        self.config = config
        self.person_class_id = int(person_class_id)
        self.rider_vehicle_class_ids = {int(v) for v in rider_vehicle_class_ids}
        self._pending: dict[tuple[int, int], int] = {}  # bucket do veículo -> frames seguidos
        self._frame = 0
        self._last_seen: dict[tuple[int, int], int] = {}
        self.stats = {"promotions": 0, "geometry_rejects": 0, "persistence_holds": 0}

    # bucket grosseiro da posição do veículo: confirmação sobrevive a jitter
    @staticmethod
    def _bucket(bbox: list[int]) -> tuple[int, int]:
        cx = (bbox[0] + bbox[2]) // 2
        cy = (bbox[1] + bbox[3]) // 2
        return (cx // 48, cy // 48)

    def _plausible(self, person_bbox: list[int], vehicle_bbox: list[int]) -> bool:
        px1, py1, px2, py2 = person_bbox
        vx1, vy1, vx2, vy2 = vehicle_bbox
        person_w = max(1, px2 - px1)
        person_h = max(1, py2 - py1)
        vehicle_h = max(1, vy2 - vy1)
        # sobreposição horizontal relativa à pessoa
        overlap_x = min(px2, vx2) - max(px1, vx1)
        if overlap_x / person_w < self.config.horizontal_overlap_min:
            return False
        # pé da pessoa na zona de montaria do veículo
        foot_min = vy1 + self.config.foot_zone_top * vehicle_h
        foot_max = vy2 + self.config.foot_zone_bottom_slack * vehicle_h
        if not (foot_min <= py2 <= foot_max):
            return False
        # pessoa desproporcional (poste/árvore classificado errado)
        if person_h / vehicle_h > self.config.max_person_vehicle_height_ratio:
            return False
        # cabeça da pessoa acima do topo do veículo (montada, não atrás)
        if py1 >= vy2:
            return False
        return True

    def apply(self, detections: list, person_threshold: float) -> list:
        """Recebe a lista de Detection ANTES do tracking; devolve a lista com
        pessoas promovidas e SEM as pessoas fracas não promovidas."""
        self._frame += 1
        if not self.config.enabled:
            # flag off: descarta qualquer pessoa abaixo do threshold que tenha
            # sobrevivido até aqui (não deveria haver, mas é barato garantir)
            return [d for d in detections
                    if not ((d.extra or {}).get("belowThreshold"))]

        vehicles = [d for d in detections
                    if int((d.extra or {}).get("classId", -1)) in self.rider_vehicle_class_ids
                    and float(d.confidence) >= self.config.vehicle_min]
        output = []
        for det in detections:
            extra = det.extra or {}
            is_weak_person = bool(extra.get("belowThreshold")) and \
                int(extra.get("classId", -1)) == self.person_class_id
            if not is_weak_person:
                output.append(det)
                continue
            promoted = False
            for vehicle in vehicles:
                if not self._plausible(det.bbox, vehicle.bbox):
                    continue
                bucket = self._bucket(vehicle.bbox)
                streak = self._pending.get(bucket, 0)
                if self._last_seen.get(bucket, -10) < self._frame - 2:
                    streak = 0  # confirmação expirada: recomeça
                streak += 1
                self._pending[bucket] = streak
                self._last_seen[bucket] = self._frame
                if streak >= self.config.confirm_frames:
                    det.confidence = max(float(det.confidence), float(person_threshold))
                    det.extra = {**extra, "riderPromoted": True, "belowThreshold": False}
                    output.append(det)
                    self.stats["promotions"] += 1
                    promoted = True
                else:
                    self.stats["persistence_holds"] += 1
                break
            if not promoted and not any(self._plausible(det.bbox, v.bbox) for v in vehicles):
                self.stats["geometry_rejects"] += 1
            # pessoa fraca não promovida NÃO segue no pipeline
        # limpeza de buckets antigos (memória curta)
        stale = [b for b, seen in self._last_seen.items() if seen < self._frame - 30]
        for bucket in stale:
            self._pending.pop(bucket, None)
            self._last_seen.pop(bucket, None)
        return output
