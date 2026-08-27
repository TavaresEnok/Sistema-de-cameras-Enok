import { useEffect, useMemo, useRef } from 'react';
import { Camera as CameraIcon, LocateFixed } from 'lucide-react';
import { latLngBounds, type Map as LeafletMap } from 'leaflet';
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Camera } from '../store/vmsDataStore';
import {
  agruparPorPosicao,
  explicacaoDoPonto,
  rotuloDoPonto,
  type PontoNoMapa,
} from '../lib/posicao-no-mapa';

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
  // AGRUPA em vez de espalhar. Ver lib/posicao-no-mapa.ts: até 27/08/2026 os
  // marcadores empilhados eram abertos num leque de ~130 m "só para ficarem
  // clicáveis" — e isso fazia 25 estimativas idênticas parecerem 25 medidas.
  const pontos = useMemo<PontoNoMapa[]>(() => agruparPorPosicao(positioned), [positioned]);
  const positions = useMemo<PositionedCamera[]>(
    () => pontos.map((ponto) => ({
      camera: ponto.cameras[0] as Camera,
      position: { latitude: ponto.latitude, longitude: ponto.longitude },
    })),
    [pontos],
  );
  const signature = pontos.map((p) => `${p.id}:${p.cameras.length}`).join('|');

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
        {pontos.map((ponto) => {
          const algumaOnline = ponto.cameras.some((c) => (c as Camera).isOnline);
          // Estimativa em âmbar e tracejada; posição conferida em verde/cinza
          // sólido. A diferença é visual E textual — cor sozinha não informa
          // quem não distingue cores.
          const cor = ponto.estimado ? '#d97706' : algumaOnline ? '#10b981' : '#64748b';
          const preenchimento = ponto.estimado ? '#78350f' : algumaOnline ? '#064e3b' : '#1e293b';
          return (
            <CircleMarker
              key={ponto.id}
              center={[ponto.latitude, ponto.longitude]}
              radius={ponto.agrupado ? 15 : 11}
              pathOptions={{
                color: cor,
                fillColor: preenchimento,
                fillOpacity: 0.96,
                opacity: 1,
                weight: 3,
                dashArray: ponto.estimado ? '4 3' : undefined,
              }}
              eventHandlers={
                ponto.agrupado || ponto.estimado
                  ? undefined
                  : { click: () => onOpen(ponto.cameras[0] as Camera) }
              }
            >
              <Tooltip direction="bottom" offset={[0, 17]} opacity={0.95} permanent>
                {rotuloDoPonto(ponto)}{ponto.estimado ? ' · estimado' : ''}
              </Tooltip>
              {(ponto.agrupado || ponto.estimado) && (
                <Popup>
                  <div className="max-h-56 min-w-[15rem] overflow-y-auto">
                    <p className="m-0 mb-2 text-[11px] leading-relaxed text-muted-foreground">
                      {explicacaoDoPonto(ponto)}
                    </p>
                    <ul className="m-0 list-none p-0">
                      {ponto.cameras.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => onOpen(c as Camera)}
                            className="w-full rounded px-1.5 py-1 text-left text-xs hover:bg-accent"
                          >
                            {c.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Popup>
              )}
            </CircleMarker>
          );
        })}
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
