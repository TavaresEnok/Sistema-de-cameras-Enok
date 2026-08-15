"""Tracker AjustCam — especializado para CFTV fixo (e preparado para PTZ).

O que ele faz que o ByteTrack genérico não faz, e por quê:

1. ASSOCIAÇÃO PELO PÉ DA CAIXA (bottom-center), normalizada pelo tamanho.
   Em câmera alta, quem se aproxima muda muito de escala: o CENTRO da caixa
   "salta" para baixo a cada frame e o IoU entre frames despenca — o tracker
   genérico solta o ID. O pé (bottom-center) é o ponto de contato com o chão e
   se move de forma contínua. Mesma estratégia do Norfair customizado do
   Frigate, implementada aqui sem dependência externa.

2. DOIS ESTÁGIOS DE CONFIANÇA (espírito do ByteTrack, mantido).
   Detecções fortes associam primeiro; as fracas (>= low_conf_floor) só podem
   SUSTENTAR trilhas existentes, nunca criar novas. É o que segura o ID da
   pessoa perto da câmera quando a confiança do YOLO oscila.

3. OCLUSÃO COM RECUPERAÇÃO DE ID.
   Trilha sem observação vira "perdida" (não some): continua sendo predita por
   `recovery_grace_ms` com um gate maior. Se algo compatível reaparecer perto
   da posição prevista, o ID antigo volta (recovered=True) — pessoa que passou
   atrás do poste continua sendo a pessoa 7, não a 12.

4. OBJETO ESTACIONÁRIO (estilo Frigate: histórico + mediana + IoU).
   Mantém as últimas N caixas; se a caixa atual tem IoU alto com a MEDIANA do
   histórico por N frames, a trilha é `stationary=True` e ganha tolerância
   extra a misses (detector piscando não derruba objeto parado). Sai do estado
   quando o IoU contra a mediana cai por vários frames seguidos.

5. COMPENSAÇÃO DE MOVIMENTO GLOBAL (hook para PTZ/vibração).
   `apply_global_shift(dx, dy)` desloca todas as predições antes da associação.
   Quem estima o deslocamento é o detector (camera_motion.py), aqui só se
   aplica — assim o tracker continua puro e testável.

Filtro de Kalman: velocidade constante sobre o estado
    x = [bx, by, w, h, vbx, vby, vw, vh]   (bx,by = bottom-center)
com medida z = [bx, by, w, h]. Implementação direta em numpy (8x8), sem scipy.
A associação usa Hungarian se scipy existir; caso contrário, greedy por menor
custo — com meia dúzia de objetos por câmera a diferença é irrelevante.
"""
from __future__ import annotations

import time
from collections import deque

import numpy as np

from .base import TrackedBox, TrackerBackend
from .appearance import blend as sig_blend, signature as sig_compute, similarity as sig_similarity

try:  # scipy é opcional; greedy cobre o caso típico de CFTV (poucos objetos)
    from scipy.optimize import linear_sum_assignment as _hungarian
except Exception:  # pragma: no cover
    _hungarian = None


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    ix1 = max(a[0], b[0]); iy1 = max(a[1], b[1])
    ix2 = min(a[2], b[2]); iy2 = min(a[3], b[3])
    iw = max(0.0, ix2 - ix1); ih = max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, (a[2] - a[0])) * max(0.0, (a[3] - a[1]))
    area_b = max(0.0, (b[2] - b[0])) * max(0.0, (b[3] - b[1]))
    union = area_a + area_b - inter
    return float(inter / union) if union > 0 else 0.0


def _to_z(bbox: np.ndarray) -> np.ndarray:
    """xyxy -> [bottom_center_x, bottom_center_y, w, h]"""
    x1, y1, x2, y2 = float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])
    return np.array([(x1 + x2) / 2.0, y2, max(1.0, x2 - x1), max(1.0, y2 - y1)], dtype=np.float64)


def _to_bbox(z: np.ndarray) -> np.ndarray:
    bx, by, w, h = float(z[0]), float(z[1]), max(1.0, float(z[2])), max(1.0, float(z[3]))
    return np.array([bx - w / 2.0, by - h, bx + w / 2.0, by], dtype=np.float32)


class _Kalman:
    """Velocidade constante, 8 estados / 4 medidas, dt=1 frame."""

    F = np.eye(8)
    F[0, 4] = F[1, 5] = F[2, 6] = F[3, 7] = 1.0
    H = np.zeros((4, 8)); H[0, 0] = H[1, 1] = H[2, 2] = H[3, 3] = 1.0

    def __init__(self, z0: np.ndarray):
        self.x = np.zeros(8); self.x[:4] = z0
        self.P = np.diag([10.0, 10.0, 10.0, 10.0, 1e3, 1e3, 1e3, 1e3])
        # Ruído relativo ao tamanho: caixas grandes (pessoa perto) podem variar
        # mais pixels por frame sem que isso vire "salto".
        self._q_pos = 1.0
        self._q_vel = 0.5
        self._r = 1.0

    def predict(self) -> np.ndarray:
        h = max(8.0, self.x[3])
        q = np.diag([self._q_pos * h * 0.05] * 4 + [self._q_vel * h * 0.02] * 4) ** 2
        self.x = self.F @ self.x
        self.P = self.F @ self.P @ self.F.T + q
        return self.x[:4].copy()

    def correct(self, z: np.ndarray) -> None:
        h = max(8.0, z[3])
        r = np.diag([self._r * h * 0.05] * 4) ** 2
        y = z - self.H @ self.x
        s = self.H @ self.P @ self.H.T + r
        k = self.P @ self.H.T @ np.linalg.inv(s)
        self.x = self.x + k @ y
        self.P = (np.eye(8) - k @ self.H) @ self.P

    def shift(self, dx: float, dy: float) -> None:
        self.x[0] += dx
        self.x[1] += dy


class _Track:
    __slots__ = ("kf", "track_id", "confidence", "hits", "misses", "lost_at",
                 "history", "stationary", "stationary_break", "recovered", "last_z",
                 "signature")

    def __init__(self, track_id: int, z: np.ndarray, confidence: float, history_len: int):
        self.kf = _Kalman(z)
        self.track_id = int(track_id)
        self.confidence = float(confidence)
        self.hits = 1
        self.misses = 0
        self.lost_at = 0.0            # > 0 quando está na piscina de perdidas
        self.history: deque = deque(maxlen=history_len)
        self.history.append(_to_bbox(z))
        self.stationary = False
        self.stationary_break = 0
        self.recovered = False
        self.last_z = z.copy()
        self.signature = None  # aparência (EMA), ver trackers/appearance.py

    @property
    def lost(self) -> bool:
        return self.lost_at > 0.0


class AjustCamTracker(TrackerBackend):
    name = "ajustcam"

    def __init__(self, class_id: int, activation_threshold: float,
                 lost_track_buffer: int, frame_rate: int,
                 low_conf_floor: float = 0.10,
                 recovery_grace_ms: int = 2000,
                 stationary_frames: int = 10,
                 stationary_iou: float = 0.88,
                 stationary_out_iou: float = 0.70,
                 match_gate: float = 1.0,
                 recovery_gate: float = 1.8,
                 appearance: bool = True,
                 appearance_veto: float = 0.10,
                 appearance_weight: float = 0.25,
                 min_hits: int = 1,
                 stationary_coast: bool = True,
                 **kwargs):
        super().__init__(class_id, activation_threshold, lost_track_buffer, frame_rate, **kwargs)
        self.low_conf_floor = float(low_conf_floor)
        self.recovery_grace_s = max(0.0, float(recovery_grace_ms) / 1000.0)
        self.stationary_frames = max(3, int(stationary_frames))
        self.stationary_iou = float(stationary_iou)
        self.stationary_out_iou = float(stationary_out_iou)
        self.match_gate = float(match_gate)
        self.recovery_gate = float(recovery_gate)
        # Aparência: só CONFIRMA/VETA; nunca associa sozinha (ver appearance.py)
        self.appearance = bool(appearance)
        self.appearance_veto = float(appearance_veto)
        self.appearance_weight = float(appearance_weight)
        # min_hits > 1 segura a PRIMEIRA emissão de uma trilha nova por N frames
        # (paridade com o min_initialized do Frigate; default 1 = semântica atual)
        self.min_hits = max(1, int(min_hits))
        # Estacionário em coasting: objeto parado continua emitindo a última
        # caixa mesmo quando o detector falha alguns frames (dentro do budget)
        self.stationary_coast = bool(stationary_coast)
        # miss budget de trilha ATIVA (antes de virar "perdida") — mesmo papel
        # do lost_track_buffer do ByteTrack, em frames.
        self.max_active_misses = max(1, int(lost_track_buffer))
        self._tracks: list[_Track] = []
        self._next_id = 1
        self._id_switch_guard: dict[int, float] = {}
        self.stats = {"recoveries": 0, "created": 0, "dropped": 0,
                      "stationary_now": 0, "low_conf_matches": 0}

    # ------------------------------------------------------------------ público

    def apply_global_shift(self, dx: float, dy: float, scale: float = 1.0) -> None:
        if dx == 0.0 and dy == 0.0 and scale == 1.0:
            return
        s = float(scale)
        for track in self._tracks:
            x = track.kf.x
            # afim global (rotação desprezada): pos' = pos*s + d; tamanhos e
            # velocidades escalam junto — zoom não pode virar "todo mundo cresceu"
            x[0] = x[0] * s + float(dx)
            x[1] = x[1] * s + float(dy)
            x[2] *= s
            x[3] *= s
            x[4:] *= s

    def update(self, xyxy: np.ndarray, confidences: np.ndarray, frame=None) -> list[TrackedBox]:
        now = time.monotonic()
        boxes = np.asarray(xyxy, dtype=np.float64).reshape(-1, 4) if xyxy is not None and len(xyxy) else np.zeros((0, 4))
        scores = np.asarray(confidences, dtype=np.float64).reshape(-1) if confidences is not None and len(confidences) else np.zeros((0,))

        # 1) predição de TODAS as trilhas (ativas e perdidas)
        predictions = [track.kf.predict() for track in self._tracks]

        high_idx = [i for i in range(len(boxes)) if scores[i] >= self.activation_threshold]
        low_idx = [i for i in range(len(boxes)) if self.low_conf_floor <= scores[i] < self.activation_threshold]
        zs = [_to_z(boxes[i]) for i in range(len(boxes))]
        det_sigs = [None] * len(boxes)
        if self.appearance and frame is not None:
            det_sigs = [sig_compute(frame, boxes[i]) for i in range(len(boxes))]
            # Detecções muito sobrepostas contaminam o histograma uma da outra
            # (a camisa de trás "vira" a da frente). Nesses frames a aparência
            # é suprimida — nem veta, nem atualiza a EMA — e a geometria decide
            # sozinha; a correção de troca conserta depois, na separação.
            for i in range(len(boxes)):
                for j in range(i + 1, len(boxes)):
                    if _iou(boxes[i], boxes[j]) > 0.30:
                        det_sigs[i] = None
                        det_sigs[j] = None

        active = [t for t in self._tracks if not t.lost]
        lost = [t for t in self._tracks if t.lost]
        matched_tracks: set[int] = set()
        matched_dets: set[int] = set()

        # 2) estágio 1: detecções FORTES x trilhas ATIVAS (gate normal)
        self._associate(active, predictions, zs, scores, det_sigs, high_idx, self.match_gate,
                        matched_tracks, matched_dets)
        # 3) estágio 2: detecções FRACAS sustentam ativas que sobraram
        before = len(matched_dets)
        self._associate([t for t in active if id(t) not in matched_tracks],
                        predictions, zs, scores, det_sigs, low_idx, self.match_gate,
                        matched_tracks, matched_dets)
        self.stats["low_conf_matches"] += len(matched_dets) - before
        # 4) estágio 3: RECUPERAÇÃO — fortes restantes x trilhas PERDIDAS (gate maior)
        recovered_now = self._associate(
            [t for t in lost if id(t) not in matched_tracks],
            predictions, zs, scores, det_sigs, [i for i in high_idx if i not in matched_dets],
            self.recovery_gate, matched_tracks, matched_dets, recovering=True)
        self.stats["recoveries"] += recovered_now

        # 5) trilhas sem observação neste frame
        for track in self._tracks:
            if id(track) in matched_tracks:
                continue
            track.misses += 1
            track.recovered = False
            # Sem observação, extrapolar velocidade CHEIA faz a predição "fugir"
            # do ponto de oclusão e o objeto reaparece fora do gate. Amortece
            # 10% por frame perdido — a predição avança, mas converge.
            track.kf.x[4:] *= 0.9
            miss_budget = self.max_active_misses * (3 if track.stationary else 1)
            if not track.lost and track.misses > miss_budget:
                track.lost_at = now

        # 6) novas trilhas: SOMENTE detecções fortes não associadas
        for i in high_idx:
            if i in matched_dets:
                continue
            new_track = _Track(self._next_id, zs[i], scores[i], self.stationary_frames)
            new_track.signature = det_sigs[i]
            self._tracks.append(new_track)
            # mesma semântica do ByteTrack (minimum_consecutive_frames=1):
            # a trilha nova JÁ sai no frame em que nasceu.
            matched_tracks.add(id(new_track))
            matched_dets.add(i)
            self._next_id += 1
            self.stats["created"] += 1

        # 7) expira perdidas fora da janela de graça
        kept: list[_Track] = []
        for track in self._tracks:
            if track.lost and (now - track.lost_at) > self.recovery_grace_s:
                self.stats["dropped"] += 1
                continue
            kept.append(track)
        self._tracks = kept

        # 8) saída: apenas trilhas ativas COM observação neste frame (mesma
        #    semântica do ByteTrack — quem some do frame some do overlay; a
        #    continuidade visual é papel do frontend/TTL).
        output: list[TrackedBox] = []
        stationary_count = 0
        for track in self._tracks:
            observed = (not track.lost) and id(track) in matched_tracks
            # COASTING: estacionária que o detector falhou continua na tela com
            # a última caixa (dentro do budget 3x) — pessoa parada não pisca.
            coasting = (
                self.stationary_coast and track.stationary
                and not track.lost and not observed and track.misses > 0
            )
            if not observed and not coasting:
                continue
            if track.hits < self.min_hits:
                continue  # segura emissão de trilha recém-nascida (min_hits>1)
            if observed:
                self._update_stationary(track)
            if track.stationary:
                stationary_count += 1
            output.append(TrackedBox(
                bbox=_to_bbox(track.kf.x[:4]),
                confidence=track.confidence,
                class_id=self.class_id,
                track_id=track.track_id,
                stationary=track.stationary,
                recovered=track.recovered,
                misses=track.misses,
                extra={"coasted": coasting},
            ))
        self.stats["stationary_now"] = stationary_count
        return output

    def status(self) -> dict:
        return {"name": self.name, "class_id": self.class_id,
                "tracks": len(self._tracks), **self.stats}

    # ------------------------------------------------------------------ interno

    def _distance(self, prediction: np.ndarray, z: np.ndarray) -> float:
        """Custo estilo Frigate: deslocamento do PÉ normalizado pelo tamanho
        + termo de variação de tamanho. < gate → candidato a par."""
        w = max(prediction[2], z[2], 1.0)
        h = max(prediction[3], z[3], 1.0)
        d_pos = max(abs(prediction[0] - z[0]) / w, abs(prediction[1] - z[1]) / h)
        d_size = max(abs(prediction[2] - z[2]) / max(prediction[2], 1.0),
                     abs(prediction[3] - z[3]) / max(prediction[3], 1.0))
        return float(d_pos + 0.5 * d_size)

    def _associate(self, tracks: list[_Track], predictions: list[np.ndarray],
                   zs: list[np.ndarray], scores: np.ndarray, det_sigs: list,
                   det_indices: list[int], gate: float, matched_tracks: set[int],
                   matched_dets: set[int], recovering: bool = False) -> int:
        if not tracks or not det_indices:
            return 0
        pred_by_track = {id(t): predictions[self._tracks.index(t)] for t in tracks}
        cost = np.full((len(tracks), len(det_indices)), 1e6)
        for r, track in enumerate(tracks):
            prediction = pred_by_track[id(track)]
            # Gate adaptativo: quanto mais frames sem observação, maior a
            # incerteza da predição — o gate abre até +120% (misses>=10).
            gate_r = gate * (1.0 + 0.12 * min(track.misses, 10))
            for c, i in enumerate(det_indices):
                # min(predição, última observação): a predição assume que o
                # movimento CONTINUA; quem dá meia-volta (ricochete, retorno)
                # aparece perto de onde FOI VISTO, não de onde "iria estar".
                # Ninguém teleporta — as duas âncoras juntas cobrem os dois casos.
                d = min(self._distance(prediction, zs[i]),
                        self._distance(track.last_z, zs[i]))
                if d >= gate_r:
                    continue
                sim = sig_similarity(track.signature, det_sigs[i])
                if sim is not None:
                    # VETO apenas na RECUPERAÇÃO: reatar um ID perdido a uma
                    # aparência radicalmente diferente é re-ID errado — melhor
                    # ID novo. Nos estágios ativos o veto causaria fragmentação
                    # (assinatura suja em oclusão); lá a aparência só pesa no
                    # custo, e a correção de troca abaixo desfaz swaps.
                    if recovering and sim < self.appearance_veto:
                        continue
                    d = d + self.appearance_weight * (1.0 - sim)
                cost[r, c] = d

        pairs: list[tuple[int, int]] = []
        if _hungarian is not None:
            rows, cols = _hungarian(cost)
            pairs = [(r, c) for r, c in zip(rows, cols) if cost[r, c] < 1e5]
        else:  # greedy por menor custo
            flat = [(cost[r, c], r, c) for r in range(cost.shape[0])
                    for c in range(cost.shape[1]) if cost[r, c] < 1e5]
            flat.sort()
            used_r: set[int] = set(); used_c: set[int] = set()
            for value, r, c in flat:
                if r in used_r or c in used_c:
                    continue
                used_r.add(r); used_c.add(c)
                pairs.append((r, c))

        # CORREÇÃO DE TROCA: no encontro (sobreposição), a geometria pode ter
        # cruzado os pares (cada trilha "seguiu em frente" atrás da pessoa
        # errada). Na separação, se as assinaturas CRUZADAS casam claramente
        # melhor E a troca é geometricamente plausível, desfaz-se o swap — o
        # operador vê A continuar sendo A depois do cruzamento.
        velocity_reset: set[int] = set()
        if not recovering and len(pairs) >= 2:
            swapped = True
            while swapped:
                swapped = False
                for p1 in range(len(pairs)):
                    for p2 in range(p1 + 1, len(pairs)):
                        r1, c1 = pairs[p1]
                        r2, c2 = pairs[p2]
                        t1, t2 = tracks[r1], tracks[r2]
                        i1, i2 = det_indices[c1], det_indices[c2]
                        s11 = sig_similarity(t1.signature, det_sigs[i1])
                        s12 = sig_similarity(t1.signature, det_sigs[i2])
                        s21 = sig_similarity(t2.signature, det_sigs[i1])
                        s22 = sig_similarity(t2.signature, det_sigs[i2])
                        if None in (s11, s12, s21, s22):
                            continue
                        if (s12 - s11) <= 0.25 or (s21 - s22) <= 0.25:
                            continue
                        g1 = gate * (1.0 + 0.12 * min(t1.misses, 10))
                        g2 = gate * (1.0 + 0.12 * min(t2.misses, 10))
                        d1 = min(self._distance(pred_by_track[id(t1)], zs[i2]),
                                 self._distance(t1.last_z, zs[i2]))
                        d2 = min(self._distance(pred_by_track[id(t2)], zs[i1]),
                                 self._distance(t2.last_z, zs[i1]))
                        if d1 < g1 and d2 < g2:
                            pairs[p1] = (r1, c2)
                            pairs[p2] = (r2, c1)
                            # o modelo de movimento das duas estava seguindo a
                            # pessoa ERRADA: velocidade zerada, reaprende do zero
                            velocity_reset.add(id(t1))
                            velocity_reset.add(id(t2))
                            self.stats["appearance_swaps"] = self.stats.get("appearance_swaps", 0) + 1
                            swapped = True

        recovered = 0
        for r, c in pairs:
            track = tracks[r]
            i = det_indices[c]
            z = zs[i]
            if id(track) in velocity_reset:
                track.kf.x[4:] = 0.0
            track.kf.correct(z)
            track.last_z = z.copy()
            track.signature = sig_blend(track.signature, det_sigs[i])
            # Confiança exibida = média móvel da confiança medida: evita o rótulo
            # "pessoa 31% → 78% → 12%" piscando no overlay a cada frame.
            track.confidence = float(np.clip(0.6 * track.confidence + 0.4 * float(scores[i]), 0.0, 1.0))
            track.hits += 1
            track.misses = 0
            track.history.append(_to_bbox(z))
            was_lost = recovering or track.lost
            track.recovered = bool(was_lost)
            if was_lost:
                track.lost_at = 0.0
                recovered += 1
            matched_tracks.add(id(track))
            matched_dets.add(i)
        return recovered

    def _update_stationary(self, track: _Track) -> None:
        if len(track.history) < self.stationary_frames:
            track.stationary = False
            track.stationary_break = 0
            return
        median_box = np.median(np.stack(track.history), axis=0)
        current = track.history[-1]
        iou = _iou(current, median_box)
        if track.stationary:
            if iou < self.stationary_out_iou:
                track.stationary_break += 1
                if track.stationary_break >= 3:
                    track.stationary = False
                    track.stationary_break = 0
            else:
                track.stationary_break = 0
        else:
            track.stationary = iou >= self.stationary_iou
