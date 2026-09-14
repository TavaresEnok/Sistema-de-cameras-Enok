import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera as CameraIcon, LocateFixed } from 'lucide-react';
import * as L from 'leaflet';
import { divIcon, latLngBounds, type Map as LeafletMap } from 'leaflet';
import { MapContainer, Marker, Popup, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-leaflet';
import type { Camera } from '../store/vmsDataStore';
import {
  agruparParaZoom,
  explicacaoDoPonto,
  rotuloDoPonto,
  type PontoNoMapa,
} from '../lib/posicao-no-mapa';

type Center = { latitude: number; longitude: number };
type PositionedCamera = { camera: Camera; position: Center };

const FALLBACK_CENTER: [number, number] = [-14.235, -51.9253];
const WORLD_BOUNDS: [[number, number], [number, number]] = [[-85, -180], [85, 180]];
// Mapa vetorial, sem chave e sem conta. O navegador busca os tiles diretamente
// do OpenFreeMap; a VM/Gateway nunca vira proxy de mapa. Liberty equilibra
// contraste, ruas e nomes de bairro para localizar câmeras rapidamente.
const OPEN_FREE_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// Fallback só para browsers sem WebGL ou indisponibilidade de estilo. Mantém o
// mapa utilizável em máquinas antigas, em vez de trocar a tela por um vazio.
const FALLBACK_RASTER_URL = 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png';
const FALLBACK_RASTER_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, tiles by <a href="https://www.hotosm.org/">HOT</a> / <a href="https://www.openstreetmap.fr/">OSM France</a>';

const CAMERA_MARKER_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M14.7 7.5 16.1 5H7.9l1.4 2.5" />
    <rect x="3.5" y="7.5" width="17" height="11.5" rx="3" />
    <circle cx="12" cy="13.25" r="3.25" />
    <path d="M17.5 10.5h.01" />
  </svg>`;

function cameraMarkerIcon(ponto: PontoNoMapa, online: boolean) {
  const estado = ponto.estimado ? 'estimated' : online ? 'online' : 'offline';
  const contador = ponto.agrupado
    ? `<span class="camera-map-pin__count">${ponto.cameras.length > 99 ? '99+' : ponto.cameras.length}</span>`
    : '';

  return divIcon({
    className: 'camera-map-marker-host',
    html: `
      <span class="camera-map-pin camera-map-pin--${estado}${ponto.agrupado ? ' camera-map-pin--group' : ''}">
        <span class="camera-map-pin__halo"></span>
        <span class="camera-map-pin__body">${CAMERA_MARKER_SVG}</span>
        <span class="camera-map-pin__status"></span>
        ${contador}
      </span>`,
    iconSize: [52, 60],
    iconAnchor: [26, 56],
    popupAnchor: [0, -54],
    tooltipAnchor: [0, -52],
  });
}
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

/**
 * Informa o zoom atual para fora do mapa.
 *
 * Sem isto o agrupamento era fixo: aproximar não separava nada, porque a tela
 * não sabia que o zoom havia mudado. Era o que o dono via em 28/08/2026.
 */
function OuvinteDeZoom({ aoMudar }: { aoMudar: (zoom: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const avisar = () => aoMudar(map.getZoom());
    avisar();
    map.on('zoomend', avisar);
    return () => { map.off('zoomend', avisar); };
  }, [map, aoMudar]);
  return null;
}

function SeletorDePosicaoNoMapa({
  ativo,
  aoEscolher,
}: {
  ativo: boolean;
  aoEscolher?: (position: Center) => void;
}) {
  const map = useMapEvents({
    click(event) {
      if (ativo) aoEscolher?.({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    },
  });
  useEffect(() => {
    const container = map.getContainer();
    const cursorAnterior = container.style.cursor;
    if (ativo) container.style.cursor = 'crosshair';
    return () => { container.style.cursor = cursorAnterior; };
  }, [ativo, map]);
  return null;
}

/**
 * O Leaflet mede o contêiner UMA vez. Se ele muda de tamanho depois — e passou
 * a mudar em 27/08/2026, quando a faixa de aviso entrou ACIMA do mapa — o mapa
 * continua desenhando para o tamanho antigo e a tela fica CINZA, com os
 * ladrilhos posicionados fora da área visível.
 *
 * Foi o que o dono viu: "quando dou zoom total fica cinza". Os ladrilhos
 * existiam (nove de nove responderam 200 no zoom 19); o mapa é que estava
 * desenhando no lugar errado.
 */
function VigiaDeTamanho() {
  const map = useMap();
  useEffect(() => {
    const alvo = map.getContainer();
    const remedir = () => map.invalidateSize({ animate: false });
    const observador = new ResizeObserver(remedir);
    observador.observe(alvo);
    window.addEventListener('resize', remedir);
    // Uma medida logo apos a montagem: a rota pode terminar de dimensionar
    // depois que o mapa ja nasceu.
    const t = window.setTimeout(remedir, 120);
    return () => {
      observador.disconnect();
      window.removeEventListener('resize', remedir);
      window.clearTimeout(t);
    };
  }, [map]);
  return null;
}

function navegadorTemWebGl() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Mantém toda a interação madura do Leaflet (marcadores, popup e seleção de
 * ponto), mas substitui o fundo raster por MapLibre + OpenFreeMap vetorial.
 * A camada tem fallback deliberado: falha de WebGL/rede nunca pode deixar o
 * operador sem mapa para localizar uma câmera.
 */
function BaseVetorialOpenFreeMap() {
  const map = useMap();

  useEffect(() => {
    let layer: L.MaplibreGL | null = null;
    let fallback: L.TileLayer | null = null;
    let pronto = false;
    let fallbackAtivo = false;

    const ativarFallback = () => {
      if (fallbackAtivo) return;
      fallbackAtivo = true;
      layer?.remove();
      layer = null;
      fallback = L.tileLayer(FALLBACK_RASTER_URL, {
        attribution: FALLBACK_RASTER_ATTRIBUTION,
        subdomains: 'abc',
        maxNativeZoom: 19,
        bounds: WORLD_BOUNDS,
        noWrap: true,
      }).addTo(map);
    };

    if (!navegadorTemWebGl()) {
      ativarFallback();
      return () => fallback?.remove();
    }

    try {
      layer = L.maplibreGL({
        style: OPEN_FREE_MAP_STYLE,
        interactive: false,
      }).addTo(map);
      const mapaVetorial = layer.getMaplibreMap();
      const aoCarregar = () => { pronto = true; };
      const aoErroInicial = () => { if (!pronto) ativarFallback(); };
      mapaVetorial.once('load', aoCarregar);
      mapaVetorial.once('error', aoErroInicial);
      // Falha de DNS/CSP ou estilo indisponível não pode criar uma página sem
      // fundo. Após a janela inicial, erros isolados de tile não desmontam o
      // mapa inteiro — o próprio MapLibre faz a retentativa.
      const limite = window.setTimeout(() => {
        if (!pronto) ativarFallback();
      }, 8000);

      return () => {
        window.clearTimeout(limite);
        mapaVetorial.off('load', aoCarregar);
        mapaVetorial.off('error', aoErroInicial);
        layer?.remove();
        fallback?.remove();
      };
    } catch {
      ativarFallback();
      return () => fallback?.remove();
    }
  }, [map]);

  return null;
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

export function GeographicCameraMap({
  cameras,
  onOpen,
  pickMode = false,
  onPickPosition,
}: {
  cameras: Camera[];
  onOpen: (camera: Camera) => void;
  pickMode?: boolean;
  onPickPosition?: (position: Center) => void;
}) {
  const mapRef = useRef<LeafletMap | null>(null);
  const positioned = useMemo(
    () => cameras.filter((camera) => Number.isFinite(camera.latitude) && Number.isFinite(camera.longitude)),
    [cameras],
  );
  // Agrupa no zoom distante e abre sobreposições apenas no zoom de rua. A
  // abertura é visual e não altera as coordenadas armazenadas.
  const [zoom, setZoom] = useState(4);
  const pontos = useMemo<PontoNoMapa[]>(() => agruparParaZoom(positioned, zoom), [positioned, zoom]);
  const positions = useMemo<PositionedCamera[]>(
    () => positioned.map((camera) => ({
      camera,
      position: { latitude: Number(camera.latitude), longitude: Number(camera.longitude) },
    })),
    [positioned],
  );
  // A assinatura do enquadramento usa as CÂMERAS, não os agrupamentos: se
  // dependesse dos grupos, cada mudança de zoom reenquadraria o mapa e o
  // operador nunca conseguiria aproximar — o mapa puxaria a visão de volta.
  const signature = positioned.map((c) => `${c.id}:${c.latitude}:${c.longitude}`).join('|');

  return (
    <div className="relative h-full min-h-[420px] overflow-hidden bg-[#dbe4e8]">
      <MapContainer
        ref={mapRef}
        center={FALLBACK_CENTER}
        zoom={4}
        minZoom={3}
        maxZoom={20}
        maxBounds={WORLD_BOUNDS}
        maxBoundsViscosity={1}
        worldCopyJump={false}
        scrollWheelZoom
        className="z-0 h-full min-h-[420px] w-full"
      >
        <BaseVetorialOpenFreeMap />
        <VigiaDeTamanho />
        <OuvinteDeZoom aoMudar={setZoom} />
        <SeletorDePosicaoNoMapa ativo={pickMode} aoEscolher={onPickPosition} />
        <CameraBounds positions={positions} signature={signature} />
        {pontos.map((ponto) => {
          const algumaOnline = ponto.cameras.some((c) => (c as Camera).isOnline);
          const marcador = cameraMarkerIcon(ponto, algumaOnline);
          return (
            <Marker
              key={ponto.id}
              position={[ponto.latitude, ponto.longitude]}
              icon={marcador}
              title={rotuloDoPonto(ponto)}
              alt={rotuloDoPonto(ponto)}
              bubblingMouseEvents={pickMode}
              eventHandlers={pickMode || ponto.agrupado ? undefined : { click: () => onOpen(ponto.cameras[0] as Camera) }}
            >
              <Tooltip direction="top" offset={[0, -6]} opacity={0.96}>
                {rotuloDoPonto(ponto)} · {ponto.estimado ? 'posição estimada' : algumaOnline ? 'online' : 'offline'}
              </Tooltip>
              {ponto.agrupado && (
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
            </Marker>
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
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">O sistema está tentando localizar as câmeras automaticamente pela rede. Verifique a localização e, se necessário, corrija em <strong>Editar → Localização no mapa</strong>.</div>
          </div>
        </div>
      )}
    </div>
  );
}
