import { useEffect, useMemo, useRef } from 'react';
import { Camera as CameraIcon, LocateFixed } from 'lucide-react';
import { latLngBounds, type Map as LeafletMap } from 'leaflet';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Camera } from '../store/vmsDataStore';

type Center = { latitude: number; longitude: number };
type PositionedCamera = { camera: Camera; position: Center };

const FALLBACK_CENTER: [number, number] = [-14.235, -51.9253];
const WORLD_BOUNDS: [[number, number], [number, number]] = [[-85, -180], [85, 180]];

function fitPositions(map: LeafletMap, positions: PositionedCamera[]) {
  map.invalidateSize({ animate: false });
  if (!positions.length) {
    map.setView(FALLBACK_CENTER, 4, { animate: false });
    return;
  }
  if (positions.length === 1) {
    const { latitude, longitude } = positions[0].position;
    map.setView([latitude, longitude], 16, { animate: false });
    return;
  }
  map.fitBounds(
    latLngBounds(positions.map(({ position }) => [position.latitude, position.longitude])),
    { animate: false, padding: [64, 64], maxZoom: 16 },
  );
}

function CameraBounds({ positions, signature }: { positions: PositionedCamera[]; signature: string }) {
  const map = useMap();
  useEffect(() => {
    // O contêiner pode terminar de dimensionar depois da montagem da rota.
    // O frame seguinte garante que o Leaflet calcule o centro com o tamanho real.
    const frame = requestAnimationFrame(() => fitPositions(map, positions));
    return () => cancelAnimationFrame(frame);
  }, [map, signature]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function GeographicCameraMap({ cameras, onOpen }: { cameras: Camera[]; onOpen: (camera: Camera) => void }) {
  const mapRef = useRef<LeafletMap | null>(null);
  const positioned = useMemo(
    () => cameras.filter((camera) => Number.isFinite(camera.latitude) && Number.isFinite(camera.longitude)),
    [cameras],
  );
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
        if (group.length === 1) {
          result.set(camera.id, { latitude, longitude });
          return;
        }
        // IP público compartilhado gera uma estimativa igual. O leque é só
        // visual para os marcadores continuarem clicáveis; o banco não muda.
        const ring = Math.floor(index / 10) + 1;
        const angle = (index % 10) * (Math.PI * 2 / Math.min(10, group.length));
        const radius = 0.0012 * ring;
        result.set(camera.id, {
          latitude: latitude + Math.sin(angle) * radius,
          longitude: longitude + Math.cos(angle) * radius,
        });
      });
    }
    return result;
  }, [positioned]);
  const positions = useMemo<PositionedCamera[]>(() => positioned.map((camera) => ({
    camera,
    position: displayCoordinates.get(camera.id) ?? {
      latitude: Number(camera.latitude),
      longitude: Number(camera.longitude),
    },
  })), [displayCoordinates, positioned]);
  const signature = positions.map(({ camera, position }) => `${camera.id}:${position.latitude}:${position.longitude}`).join('|');

  return (
    <div className="relative h-full min-h-[420px] overflow-hidden bg-[#dbe4e8]">
      <MapContainer
        ref={mapRef}
        center={FALLBACK_CENTER}
        zoom={4}
        minZoom={3}
        maxZoom={19}
        maxBounds={WORLD_BOUNDS}
        maxBoundsViscosity={1}
        worldCopyJump={false}
        scrollWheelZoom
        className="z-0 h-full min-h-[420px] w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          bounds={WORLD_BOUNDS}
          noWrap
        />
        <CameraBounds positions={positions} signature={signature} />
        {positions.map(({ camera, position }) => (
          <CircleMarker
            key={camera.id}
            center={[position.latitude, position.longitude]}
            radius={11}
            pathOptions={{
              color: camera.isOnline ? '#10b981' : '#64748b',
              fillColor: camera.isOnline ? '#064e3b' : '#1e293b',
              fillOpacity: 0.96,
              opacity: 1,
              weight: 3,
            }}
            eventHandlers={{ click: () => onOpen(camera) }}
          >
            <Tooltip direction="bottom" offset={[0, 13]} opacity={0.95} permanent>{camera.name}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      <button
        type="button"
        onClick={() => mapRef.current && fitPositions(mapRef.current, positions)}
        className="absolute right-3 top-3 z-[800] flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-lg hover:bg-accent"
        aria-label="Mostrar todas as câmeras"
        title="Mostrar todas as câmeras"
      >
        <LocateFixed className="h-4 w-4" />
      </button>

      {!positions.length && (
        <div className="pointer-events-none absolute inset-0 z-[700] flex items-center justify-center p-6">
          <div className="max-w-sm rounded-xl border border-border bg-card/95 p-5 text-center shadow-xl">
            <CameraIcon className="mx-auto h-7 w-7 text-primary" />
            <div className="mt-3 text-sm font-semibold">{cameras.length} câmera{cameras.length === 1 ? '' : 's'} cadastrada{cameras.length === 1 ? '' : 's'}</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">O sistema tentará estimar a localização automaticamente. Se necessário, corrija o endereço na opção Editar da câmera.</div>
          </div>
        </div>
      )}
    </div>
  );
}
