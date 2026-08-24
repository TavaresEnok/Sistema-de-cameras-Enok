#!/usr/bin/env python3
"""Gera uma página local para revisão humana do benchmark de movimento.

Não toca na gravação nem nos serviços do DRAC. A entrada são as referências
semânticas offline e os seis vídeos de laboratório; a saída são clipes curtos,
um manifesto e uma página estática. As decisões ficam primeiro no navegador e
podem ser exportadas em JSON para posterior análise do benchmark.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


FPS = 2.0
WARMUP_FRAMES = 60
LEAD_SECONDS = 4.0
TAIL_SECONDS = 8.0


def events_from_active(active: list[bool]) -> list[tuple[int, int]]:
    """Mesma regra da referência: dois quadros, lacuna de três e união em 5 s."""
    events: list[tuple[int, int]] = []
    run = gap = 0
    start: int | None = None
    for index, is_active in enumerate(active):
        if is_active:
            gap = 0
            run += 1
            if start is None and run >= 2:
                start = index - 1
        else:
            run = 0
            if start is not None:
                gap += 1
                if gap >= 3:
                    events.append((start, index - gap))
                    start = None
                    gap = 0
    if start is not None:
        events.append((start, len(active) - 1))

    merged: list[tuple[int, int]] = []
    for event in events:
        if merged and event[0] - merged[-1][1] <= round(5.0 * FPS):
            merged[-1] = (merged[-1][0], event[1])
        else:
            merged.append(event)
    return merged


def write_page(output: Path) -> None:
    (output / "index.html").write_text(PAGE, encoding="utf-8")


def source_fps(video: Path) -> float:
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "default=nw=1:nk=1", str(video)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    # Alguns TS anunciam mais de um programa e o ffprobe devolve uma linha por
    # programa mesmo com select_streams. A primeira taxa de vídeo é a usada
    # pelo decodificador; nunca concatenar as linhas como se fossem uma fração.
    rate = next((line for line in probe.splitlines() if "/" in line), "")
    numerator, denominator = rate.split("/", 1)
    return float(numerator) / float(denominator)


def clip(video: Path, output: Path, start: float, duration: float) -> None:
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-i", str(video),
            "-t", f"{duration:.3f}", "-an", "-vf", "scale=-2:360", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
            "-movflags", "+faststart", str(output),
        ],
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--captures", type=Path, required=True)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--force", action="store_true", help="regerar inclusive clipes existentes")
    args = parser.parse_args()

    output = args.output.resolve()
    if output == Path("/") or len(output.parts) < 4:
        raise SystemExit("diretório de saída inválido")
    output.mkdir(parents=True, exist_ok=True)
    clips = output / "clips"
    clips.mkdir(exist_ok=True)
    items: list[dict] = []

    for reference_path in sorted(args.references.glob("noturno-cam-*-flow.json")):
        reference = json.loads(reference_path.read_text(encoding="utf-8"))
        camera = reference_path.name.removesuffix("-flow.json").removeprefix("noturno-")
        video = args.captures / f"{camera}.ts"
        if not video.exists():
            raise SystemExit(f"vídeo ausente: {video}")
        native_fps = source_fps(video)
        frames = reference["frames"][: int(reference["sampled_frames"])]
        for event_number, (start_frame, end_frame) in enumerate(
            events_from_active([bool(frame.get("moving")) for frame in frames]), start=1
        ):
            # A rodada que produziu os 264 candidatos exclui os primeiros 30 s
            # para acomodar o Fast Self-Tuning; a revisão reproduz esse recorte.
            if end_frame < WARMUP_FRAMES:
                continue
            event_start = max(start_frame, WARMUP_FRAMES)
            first = frames[event_start]
            last = frames[end_frame]
            source_start_frame = int(first.get("source_frame", 0))
            source_end_frame = int(last.get("source_frame", source_start_frame))
            at = max(0.0, source_start_frame / native_fps - LEAD_SECONDS)
            until = max(at + 1.0, source_end_frame / native_fps + TAIL_SECONDS)
            duration = min(20.0, until - at)
            identifier = f"{camera}-e{event_number:03d}"
            target = clips / f"{identifier}.mp4"
            if args.force or not target.exists() or target.stat().st_size == 0:
                clip(video, target, at, duration)
            classes = sorted({str(entry.get("class", "objeto")) for frame in frames[event_start:end_frame + 1] for entry in frame.get("moving", [])})
            items.append({
                "id": identifier,
                "camera": camera,
                "eventStartFrame": event_start,
                "eventEndFrame": end_frame,
                "video": f"clips/{target.name}",
                "sourceTimeSeconds": round(source_start_frame / native_fps, 3),
                "classes": classes,
            })

    (output / "events.json").write_text(json.dumps({
        "schema": 1,
        "title": "Revisão humana — benchmark de movimento",
        "items": items,
        "notes": "Candidatos semânticos após 30 segundos de aquecimento. A revisão humana é a fonte de verdade.",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    write_page(output)
    print(f"Gerados {len(items)} clipes em {output}")


PAGE = r'''<!doctype html>
<html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Revisão de movimentos</title>
<style>
:root{color-scheme:dark;--bg:#111318;--panel:#1b1f27;--line:#303846;--txt:#eef2f8;--muted:#9ca7b8;--yes:#20b976;--no:#ea6262;--skip:#e6ae3d}*{box-sizing:border-box}body{margin:0;background:var(--bg);font:16px system-ui,sans-serif;color:var(--txt)}main{max-width:1050px;margin:auto;padding:28px 18px}header{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:18px}h1{font-size:22px;margin:0}small{color:var(--muted)}.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px}.meta{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px;color:var(--muted)}video{width:100%;max-height:65vh;background:#000;border-radius:10px}.buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:15px}button{padding:15px 10px;border:1px solid var(--line);border-radius:10px;background:#262d38;color:var(--txt);font-weight:700;font-size:15px;cursor:pointer}button:hover{filter:brightness(1.14)}.yes{border-color:var(--yes);color:#c8ffe3}.no{border-color:var(--no);color:#ffd1d1}.skip{border-color:var(--skip);color:#ffe6af}.tools{display:flex;gap:10px;flex-wrap:wrap;margin-top:15px}.tools button{font-size:13px;padding:10px 12px}.bar{height:8px;background:#2a303b;border-radius:9px;overflow:hidden}.bar i{display:block;height:100%;background:#4e8eee;width:0}#done{font-size:14px;color:var(--muted)}kbd{padding:2px 5px;border:1px solid #586275;border-radius:4px;font-size:12px}dialog{background:var(--panel);color:var(--txt);border:1px solid var(--line);border-radius:12px;max-width:520px}dialog textarea{width:100%;height:180px;background:#101319;color:#fff;border:1px solid var(--line)}
</style><main><header><div><h1>Revisão humana de movimento</h1><small id="subtitle">Carregando candidatos…</small></div><div id="done"></div></header><div class="bar"><i id="progress"></i></div><br><section class="card"><div class="meta"><span id="camera"></span><span id="position"></span></div><video id="video" controls autoplay muted playsinline></video><p id="details"></p><div class="buttons"><button class="yes" data-v="real">✓ Movimento real <small>(1)</small></button><button class="no" data-v="nao_movimento">× Não é movimento <small>(2)</small></button><button class="skip" data-v="incerto">? Não consigo avaliar <small>(3)</small></button></div><div class="tools"><button id="back">← Anterior</button><button id="clear">Remover decisão</button><button id="export">Exportar decisões JSON</button><button id="import">Importar JSON</button></div></section><dialog id="dialog"><p>Cole aqui um arquivo JSON exportado anteriormente.</p><textarea id="paste"></textarea><p><button id="load">Importar</button> <button onclick="dialog.close()">Cancelar</button></p></dialog></main><script>
const KEY='drac-motion-review-v1';let items=[],answers={},pos=0;const $=id=>document.getElementById(id);const save=()=>localStorage.setItem(KEY,JSON.stringify(answers));
function unansweredIndex(from=0){for(let i=from;i<items.length;i++)if(!answers[items[i].id])return i;return -1}
function render(){if(!items.length)return;pos=Math.max(0,Math.min(pos,items.length-1));const e=items[pos],a=answers[e.id];$('video').src=e.video;$('camera').textContent=e.camera+' · '+(e.classes.join(', ')||'objeto');$('position').textContent=`${pos+1} de ${items.length}${a?' · '+a.decisao:''}`;$('details').textContent=`Trecho iniciado em ${e.sourceTimeSeconds}s do vídeo original. Revise apenas se há movimento real relevante.`;const n=Object.keys(answers).length;$('done').textContent=`${n}/${items.length} revisados`;$('progress').style.width=(100*n/items.length)+'%'}
function decide(decisao){const e=items[pos];answers[e.id]={decisao,reviewedAt:new Date().toISOString(),camera:e.camera,eventStartFrame:e.eventStartFrame,eventEndFrame:e.eventEndFrame};save();const next=unansweredIndex(pos+1);pos=next<0?Math.min(pos+1,items.length-1):next;render()}
document.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>decide(b.dataset.v));$('back').onclick=()=>{pos=Math.max(0,pos-1);render()};$('clear').onclick=()=>{delete answers[items[pos].id];save();render()};$('export').onclick=()=>{const blob=new Blob([JSON.stringify({schema:1,exportedAt:new Date().toISOString(),answers},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='revisao-movimento.json';a.click();URL.revokeObjectURL(a.href)};$('import').onclick=()=>$('dialog').showModal();$('load').onclick=()=>{try{const d=JSON.parse($('paste').value);answers=d.answers||{};save();$('dialog').close();pos=unansweredIndex()||0;render()}catch{alert('JSON inválido.')}};document.addEventListener('keydown',e=>{if(e.target.tagName==='TEXTAREA')return;if(e.key==='1')decide('real');if(e.key==='2')decide('nao_movimento');if(e.key==='3')decide('incerto');if(e.key==='ArrowLeft'){$('back').click()}});fetch('events.json').then(r=>r.json()).then(d=>{items=d.items;answers=JSON.parse(localStorage.getItem(KEY)||'{}');pos=Math.max(0,unansweredIndex());$('subtitle').textContent=d.notes;render()}).catch(()=>{$('subtitle').textContent='Não foi possível carregar events.json.'});
</script>'''


if __name__ == "__main__":
    main()
