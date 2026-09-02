import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera as CameraIcon, LocateFixed } from 'lucide-react';
import maplibregl, { LngLatBounds, type Map as MapLibreMap, type Marker as MapLibreMarker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Camera } from '../store/vmsDataStore';
import { agruparParaZoom, explicacaoDoPonto, rotuloDoPonto, type PontoNoMapa } from '../lib/posicao-no-mapa';

type Center = { latitude: number; longitude: number };
type PositionedCamera = { camera: Camera; position: Center };

const FALLBACK_CENTER: [number, number] = [-51.9253, -14.235];
const WORLD_BOUNDS: [[number, number], [number, number]] = [[-180, -85], [180, 85]];
// Vetores OpenFreeMap: nenhum cadastro, chave ou custo por visualização. O
// próprio estilo entrega a atribuição obrigatória de OpenStreetMap/OpenMapTiles.
const BASE_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const CAMERA_MARKER_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M14.7 7.5 16.1 5H7.9l1.4 2.5" />
    <rect x="3.5" y="7.5" width="17" height="11.5" rx="3" />
    <circle cx="12" cy="13.25" r="3.25" />
    <path d="M17.5 10.5h.01" />
  </svg>`;

function marcadorHtml(ponto: PontoNoMapa, online: boolean) {
  const estado = ponto.estimado ? 'estimated' : online ? 'online' : 'offline';
  const contador = ponto.agrupado
    ? `<span class="camera-map-pin__count">${ponto.cameras.length > 99 ? '99+' : ponto.cameras.length}</span>`
    : '';
  return `
    <span class="camera-map-pin camera-map-pin--${estado}${ponto.agrupado ? ' camera-map-pin--group' : ''}">
      <span class="camera-map-pin__halo"></span>
      <span class="camera-map-pin__body">${CAMERA_MARKER_SVG}</span>
      <span class="camera-map-pin__status"></span>
      ${contador}
    </span>`;
}

function enquadrar(map: MapLibreMap, positions: PositionedCamera[]) {
  map.resize();
  if (!positions.length) {
    map.jumpTo({ center: FALLBACK_CENTER, zoom: 4 });
    return;
  }
  if (positions.length === 1) {
    const { latitude, longitude } = positions[0].position;
    map.jumpTo({ center: [longitude, latitude], zoom: 16 });
    return;
  }
  const bounds = new LngLatBounds();
  positions.forEach(({ position }) => bounds.extend([position.longitude, position.latitude]));
  map.fitBounds(bounds, { padding: 64, maxZoom: 16, duration: 0 });
}

function popupDeGrupo(ponto: PontoNoMapa, onOpen: (camera: Camera) => void) {
  const content = document.createElement('div');
  content.className = 'camera-map-popup max-h-56 min-w-[15rem] overflow-y-auto';
  const explicacao = document.createElement('p');
  explicacao.className = 'm-0 mb-2 text-[11px] leading-relaxed text-muted-foreground';
  explicacao.textContent = explicacaoDoPonto(ponto);
  content.appendChild(explicacao);
  const lista = document.createElement('ul');
  lista.className = 'm-0 list-none p-0';
  ponto.cameras.forEach((camera) => {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'w-full rounded px-1.5 py-1 text-left text-xs hover:bg-accent';
    botao.textContent = camera.name;
    botao.addEventListener('click', () => onOpen(camera as Camera));
    const item = document.createElement('li');
    item.appendChild(botao);
    lista.appendChild(item);
  });
  content.appendChild(lista);
  return content;
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<MapLibreMarker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [zoom, setZoom] = useState(4);
  const positioned = useMemo(
    () => cameras.filter((camera) => Number.isFinite(camera.latitude) && Number.isFinite(camera.longitude)),
    [cameras],
  );
  const positions = useMemo<PositionedCamera[]>(
    () => positioned.map((camera) => ({
      camera,
      position: { latitude: Number(camera.latitude), longitude: Number(camera.longitude) },
    })),
    [positioned],
  );
  const pontos = useMemo<PontoNoMapa[]>(() => agruparParaZoom(positioned, zoom), [positioned, zoom]);
  // O zoom não participa da assinatura: aproximar nunca pode reenquadrar a
  // visão do operador de volta para o Brasil inteiro.
  const signature = positioned.map((c) => `${c.id}:${c.latitude}:${c.longitude}`).join('|');

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    const map = new maplibregl.Map({
      container,
      style: BASE_MAP_STYLE,
      center: FALLBACK_CENTER,
      zoom: 4,
      minZoom: 3,
      maxZoom: 20,
      maxBounds: WORLD_BOUNDS,
      renderWorldCopies: false,
      attributionControl: {},
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.on('load', () => setMapReady(true));
    map.on('zoomend', () => setZoom(map.getZoom()));
    mapRef.current = map;

    // MapLibre ainda não possui matriz/projeção durante o carregamento inicial
    // do estilo. Um ResizeObserver pode disparar antes do `load` e chamar
    // resize nesse intervalo, causando o erro "reading '0'" do motor.
    const resizeObserver = new ResizeObserver(() => {
      if (map.isStyleLoaded()) map.resize();
    });
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const frame = requestAnimationFrame(() => enquadrar(map, positions));
    return () => cancelAnimationFrame(frame);
  }, [mapReady, signature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const canvas = map.getCanvas();
    canvas.style.cursor = pickMode ? 'crosshair' : '';
    const onClick = (event: maplibregl.MapMouseEvent) => {
      if (pickMode) onPickPosition?.({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
    };
    map.on('click', onClick);
    return () => {
      canvas.style.cursor = '';
      map.off('click', onClick);
    };
  }, [mapReady, pickMode, onPickPosition]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = pontos.map((ponto) => {
      const algumaOnline = ponto.cameras.some((camera) => (camera as Camera).isOnline);
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `camera-map-marker-host${pickMode ? ' pointer-events-none' : ''}`;
      element.innerHTML = marcadorHtml(ponto, algumaOnline);
      element.title = rotuloDoPonto(ponto);
      element.setAttribute('aria-label', rotuloDoPonto(ponto));

      const marker = new maplibregl.Marker({ element, anchor: 'bottom' })
        .setLngLat([ponto.longitude, ponto.latitude])
        .addTo(map);
      if (!pickMode && ponto.agrupado) {
        const popup = new maplibregl.Popup({ offset: 12, closeButton: true, maxWidth: '260px' })
          .setDOMContent(popupDeGrupo(ponto, onOpen));
        marker.setPopup(popup);
      } else if (!pickMode) {
        element.addEventListener('click', () => onOpen(ponto.cameras[0] as Camera));
      }
      return marker;
    });
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
    };
  }, [mapReady, pontos, onOpen, pickMode]);

  const mostrarTodas = useCallback(() => {
    const map = mapRef.current;
    if (map) enquadrar(map, positions);
  }, [positions]);

  return (
    <div className="relative h-full min-h-[420px] overflow-hidden bg-[#dbe4e8]">
      <div ref={containerRef} className="z-0 h-full min-h-[420px] w-full" />
      <button
        type="button"
        onClick={mostrarTodas}
        className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-lg hover:bg-accent"
        aria-label="Mostrar todas as câmeras"
        title="Mostrar todas as câmeras"
      >
        <LocateFixed className="h-4 w-4" />
      </button>
      {!positions.length && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
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
