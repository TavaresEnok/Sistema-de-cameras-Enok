import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera as CameraIcon, LocateFixed, Minus, Plus } from 'lucide-react';
import type { Camera } from '../store/vmsDataStore';

type Center = { latitude: number; longitude: number };
type Size = { width: number; height: number };

const TILE = 256;
const FALLBACK_CENTER: Center = { latitude: -14.235, longitude: -51.9253 };

function clampLatitude(value: number) { return Math.max(-85.0511, Math.min(85.0511, value)); }
function worldSize(zoom: number) { return TILE * 2 ** zoom; }
function toWorld(latitude: number, longitude: number, zoom: number) {
  const size = worldSize(zoom);
  const lat = clampLatitude(latitude) * Math.PI / 180;
  return {
    x: ((longitude + 180) / 360) * size,
    y: (0.5 - Math.log((1 + Math.sin(lat)) / (1 - Math.sin(lat))) / (4 * Math.PI)) * size,
  };
}
function fromWorld(x: number, y: number, zoom: number): Center {
  const size = worldSize(zoom);
  const longitude = ((x / size) * 360 + 540) % 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / size;
  return { latitude: clampLatitude((180 / Math.PI) * Math.atan(Math.sinh(n))), longitude };
}

export function GeographicCameraMap({ cameras, onOpen }: { cameras: Camera[]; onOpen: (camera: Camera) => void }) {
  const positioned = useMemo(() => cameras.filter((camera) => Number.isFinite(camera.latitude) && Number.isFinite(camera.longitude)), [cameras]);
  const displayCoordinates = useMemo(() => {
    const groups = new Map<string, Camera[]>();
    for (const camera of positioned) {
      const key = `${Number(camera.latitude).toFixed(5)}:${Number(camera.longitude).toFixed(5)}`;
      groups.set(key, [...(groups.get(key) ?? []), camera]);
    }
    const result = new Map<string, Center>();
    for (const group of groups.values()) {
      group.forEach((camera, index) => {
        const latitude = Number(camera.latitude);
        const longitude = Number(camera.longitude);
        if (group.length === 1) { result.set(camera.id, { latitude, longitude }); return; }
        // IP público compartilhado coloca várias câmeras no mesmo ponto. O
        // pequeno leque é só visual e permite clicar em cada câmera; não muda o banco.
        const ring = Math.floor(index / 10) + 1;
        const angle = (index % 10) * (Math.PI * 2 / Math.min(10, group.length));
        const radius = 0.0012 * ring;
        result.set(camera.id, { latitude: latitude + Math.sin(angle) * radius, longitude: longitude + Math.cos(angle) * radius });
      });
    }
    return result;
  }, [positioned]);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; center: Center } | null>(null);
  const [size, setSize] = useState<Size>({ width: 900, height: 600 });
  const [center, setCenter] = useState<Center>(FALLBACK_CENTER);
  const [zoom, setZoom] = useState(4);
  const positionedKey = positioned.map((camera) => `${camera.id}:${camera.latitude}:${camera.longitude}`).join('|');

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = () => {
    if (!positioned.length) { setCenter(FALLBACK_CENTER); setZoom(4); return; }
    const latitude = positioned.reduce((sum, camera) => sum + Number(camera.latitude), 0) / positioned.length;
    const longitude = positioned.reduce((sum, camera) => sum + Number(camera.longitude), 0) / positioned.length;
    setCenter({ latitude, longitude });
    if (positioned.length === 1) { setZoom(16); return; }
    for (let candidate = 17; candidate >= 3; candidate -= 1) {
      const points = positioned.map((camera) => toWorld(Number(camera.latitude), Number(camera.longitude), candidate));
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      if (Math.max(...xs) - Math.min(...xs) <= size.width * 0.72 && Math.max(...ys) - Math.min(...ys) <= size.height * 0.72) {
        setZoom(candidate); return;
      }
    }
    setZoom(3);
  };

  useEffect(() => { fit(); }, [positionedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const centerWorld = toWorld(center.latitude, center.longitude, zoom);
  const left = centerWorld.x - size.width / 2;
  const top = centerWorld.y - size.height / 2;
  const tileCount = 2 ** zoom;
  const tiles: Array<{ key: string; x: number; y: number; srcX: number }> = [];
  const minX = Math.floor(left / TILE) - 1;
  const maxX = Math.floor((left + size.width) / TILE) + 1;
  const minY = Math.max(0, Math.floor(top / TILE) - 1);
  const maxY = Math.min(tileCount - 1, Math.floor((top + size.height) / TILE) + 1);
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const srcX = ((x % tileCount) + tileCount) % tileCount;
      tiles.push({ key: `${zoom}/${x}/${y}`, x, y, srcX });
    }
  }

  const changeZoom = (next: number, anchorX = size.width / 2, anchorY = size.height / 2) => {
    const bounded = Math.max(3, Math.min(19, next));
    if (bounded === zoom) return;
    const anchorBefore = fromWorld(left + anchorX, top + anchorY, zoom);
    const anchorAfter = toWorld(anchorBefore.latitude, anchorBefore.longitude, bounded);
    setZoom(bounded);
    setCenter(fromWorld(anchorAfter.x - anchorX + size.width / 2, anchorAfter.y - anchorY + size.height / 2, bounded));
  };

  return (
    <div
      ref={stageRef}
      className="relative h-full min-h-[420px] cursor-grab touch-none select-none overflow-hidden overscroll-contain bg-[#dbe4e8] active:cursor-grabbing"
      onWheel={(event) => {
        event.preventDefault();
        // offsetX/offsetY pertencem ao elemento mais interno sob o cursor —
        // normalmente um tile de 256px. Ao cruzar a borda do tile, o ponto do
        // zoom saltava centenas de quilômetros. clientX menos o retângulo do
        // MAPA mantém a âncora estável em qualquer tile, marcador ou legenda.
        const rect = stageRef.current?.getBoundingClientRect();
        const anchorX = rect ? Math.max(0, Math.min(rect.width, event.clientX - rect.left)) : size.width / 2;
        const anchorY = rect ? Math.max(0, Math.min(rect.height, event.clientY - rect.top)) : size.height / 2;
        changeZoom(zoom + (event.deltaY < 0 ? 1 : -1), anchorX, anchorY);
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('button,a')) return;
        dragRef.current = { x: event.clientX, y: event.clientY, center };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragRef.current) return;
        const start = toWorld(dragRef.current.center.latitude, dragRef.current.center.longitude, zoom);
        setCenter(fromWorld(start.x - (event.clientX - dragRef.current.x), start.y - (event.clientY - dragRef.current.y), zoom));
      }}
      onPointerUp={(event) => { dragRef.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId); }}
      onPointerCancel={() => { dragRef.current = null; }}
      onLostPointerCapture={() => { dragRef.current = null; }}
    >
      {tiles.map((tile) => <img key={tile.key} src={`https://tile.openstreetmap.org/${zoom}/${tile.srcX}/${tile.y}.png`} alt="" draggable={false} className="pointer-events-none absolute h-64 w-64 max-w-none" style={{ left: tile.x * TILE - left, top: tile.y * TILE - top }} />)}
      <div className="pointer-events-none absolute inset-0 bg-background/5" />
      {positioned.map((camera) => {
        const display = displayCoordinates.get(camera.id) ?? { latitude: Number(camera.latitude), longitude: Number(camera.longitude) };
        const point = toWorld(display.latitude, display.longitude, zoom);
        return <button key={camera.id} type="button" onClick={() => onOpen(camera)} className="group absolute z-10 -translate-x-1/2 -translate-y-full" style={{ left: point.x - left, top: point.y - top }} title={camera.locationAddress || camera.name}>
          <span className={`flex h-10 w-10 items-center justify-center rounded-full rounded-bl-md border-2 bg-card shadow-xl transition-transform group-hover:scale-110 ${camera.isOnline ? 'border-emerald-500 text-emerald-500' : 'border-muted-foreground text-muted-foreground'}`}><CameraIcon className="h-4 w-4" /></span>
          <span className="absolute left-1/2 top-11 max-w-52 -translate-x-1/2 whitespace-nowrap rounded bg-background/90 px-2 py-1 text-[10px] font-semibold shadow backdrop-blur">{camera.name}</span>
        </button>;
      })}
      <div className="absolute right-3 top-3 z-20 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
        <button type="button" onClick={() => changeZoom(zoom + 1)} className="flex h-9 w-9 items-center justify-center hover:bg-accent" aria-label="Aproximar"><Plus className="h-4 w-4" /></button>
        <button type="button" onClick={() => changeZoom(zoom - 1)} className="flex h-9 w-9 items-center justify-center border-t border-border hover:bg-accent" aria-label="Afastar"><Minus className="h-4 w-4" /></button>
        <button type="button" onClick={fit} className="flex h-9 w-9 items-center justify-center border-t border-border hover:bg-accent" aria-label="Mostrar todas"><LocateFixed className="h-4 w-4" /></button>
      </div>
      {!positioned.length && <div className="absolute inset-0 flex items-center justify-center p-6"><div className="max-w-sm rounded-xl border border-border bg-card/95 p-5 text-center shadow-xl"><CameraIcon className="mx-auto h-7 w-7 text-primary" /><div className="mt-3 text-sm font-semibold">{cameras.length} câmera{cameras.length === 1 ? '' : 's'} cadastrada{cameras.length === 1 ? '' : 's'}</div><div className="mt-1 text-xs leading-relaxed text-muted-foreground">As câmeras já estão no sistema. Informe o endereço de cada uma na opção Editar para posicioná-las corretamente no mapa.</div></div></div>}
      <div className="absolute bottom-1 right-2 z-20 rounded bg-card/80 px-1.5 py-0.5 text-[9px] text-muted-foreground">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap</a></div>
    </div>
  );
}
