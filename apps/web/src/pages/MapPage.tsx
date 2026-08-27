import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Camera as CameraIcon, Check, ExternalLink, Layers3, Map, MapPin, Pencil, Plus, Upload, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { LiveStreamPlayer } from '../components/LiveStreamPlayer';
import { GeographicCameraMap } from '../components/GeographicCameraMap';
import { useAuthStore } from '../store/authStore';
import { useVmsDataStore, type Camera } from '../store/vmsDataStore';
import { getApiBaseUrl } from '../lib/api-base';

type Site = { id: string; name: string; location?: string | null; isActive: boolean };
type Marker = { xPct: number; yPct: number; zoneId?: string };
type Layout = { id: string; siteId: string; floor: string; svgDataUrl?: string | null; markers: Record<string, Marker> };

const API_URL = getApiBaseUrl();

function api(token?: string | null) {
  return axios.create({ baseURL: API_URL, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
}

function statusLabel(camera: Camera) {
  if (!camera.enabled) return 'Desativada';
  return camera.isOnline ? 'Online' : 'Offline';
}

export default function MapPage() {
  const token = useAuthStore((state) => state.accessToken);
  const role = useAuthStore((state) => state.user?.role ?? 'viewer');
  const cameras = useVmsDataStore((state) => state.cameras);
  const [, setLocation] = useLocation();
  const stageRef = useRef<HTMLDivElement>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [siteId, setSiteId] = useState('');
  const [floor, setFloor] = useState('');
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get('camera'));
  const [editing, setEditing] = useState(false);
  const [placingId, setPlacingId] = useState('');
  const [draftMarkers, setDraftMarkers] = useState<Record<string, Marker>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'geographic' | 'floorplan'>('geographic');

  const accessibleSiteIds = useMemo(() => new Set(cameras.map((c) => c.siteId).filter(Boolean)), [cameras]);
  const visibleSites = useMemo(
    () => sites.filter((site) => role === 'admin' || accessibleSiteIds.has(site.id)),
    [accessibleSiteIds, role, sites],
  );
  const currentLayouts = layouts.filter((layout) => layout.siteId === siteId);
  const activeLayout = currentLayouts.find((layout) => layout.floor === floor) ?? currentLayouts[0] ?? null;
  const currentMarkers = editing ? draftMarkers : (activeLayout?.markers ?? {});
  const siteCameras = cameras.filter((camera) => camera.siteId === siteId && camera.enabled);
  const mappedCameras = siteCameras.filter((camera) => currentMarkers[camera.id]);
  const unmappedCameras = siteCameras.filter((camera) => !currentMarkers[camera.id]);
  const selected = cameras.find((camera) => camera.id === selectedId) ?? null;

  useEffect(() => {
    if (!token) return;
    void api(token).get<Site[]>('/sites').then(({ data }) => setSites(data)).catch(() => setError('Não foi possível carregar as unidades.'));
  }, [token]);

  useEffect(() => {
    if (!visibleSites.length) return;
    if (!visibleSites.some((site) => site.id === siteId)) setSiteId(visibleSites[0].id);
  }, [siteId, visibleSites]);

  useEffect(() => {
    if (!token || !siteId) return;
    setError('');
    void api(token).get<Layout[]>(`/sites/${encodeURIComponent(siteId)}/map-layouts`)
      .then(({ data }) => {
        setLayouts((all) => [...all.filter((layout) => layout.siteId !== siteId), ...data]);
        setFloor((current) => data.some((layout) => layout.floor === current) ? current : (data[0]?.floor ?? 'Principal'));
      })
      .catch(() => setError('Não foi possível carregar a planta desta unidade.'));
  }, [siteId, token]);

  useEffect(() => {
    if (!editing) setDraftMarkers(activeLayout?.markers ?? {});
  }, [activeLayout, editing]);

  const openCamera = (camera: Camera) => {
    setSelectedId(camera.id);
    setLocation(`/map?camera=${encodeURIComponent(camera.id)}`, { replace: true });
  };
  const closeCamera = () => {
    setSelectedId(null);
    setLocation('/map', { replace: true });
  };

  const placeMarker = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editing || !placingId || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    setDraftMarkers((markers) => ({
      ...markers,
      [placingId]: {
        xPct: Math.max(1, Math.min(99, ((event.clientX - rect.left) / rect.width) * 100)),
        yPct: Math.max(1, Math.min(99, ((event.clientY - rect.top) / rect.height) * 100)),
      },
    }));
    setPlacingId('');
  };

  const saveLayout = async (svgDataUrl = activeLayout?.svgDataUrl ?? null) => {
    if (!token || !siteId || !floor.trim()) return;
    setSaving(true); setError('');
    try {
      const { data } = await api(token).put<Layout>(`/sites/${encodeURIComponent(siteId)}/map-layouts/${encodeURIComponent(floor.trim())}`, {
        svgDataUrl,
        markers: draftMarkers,
      });
      setLayouts((all) => [...all.filter((layout) => !(layout.siteId === data.siteId && layout.floor === data.floor)), data]);
      setEditing(false);
    } catch {
      setError('Não foi possível salvar o mapa. Verifique a imagem e tente novamente.');
    } finally { setSaving(false); }
  };

  const uploadSvg = (file?: File) => {
    if (!file) return;
    if (file.type !== 'image/svg+xml' && !file.name.toLowerCase().endsWith('.svg')) {
      setError('A planta deve estar em SVG.'); return;
    }
    const reader = new FileReader();
    reader.onload = () => void saveLayout(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  };

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-background">
      <section className="flex min-w-0 flex-1 flex-col p-4 lg:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <div className="flex items-center gap-2 text-sm font-semibold"><Map className="h-4 w-4 text-primary" /> Mapa operacional</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">Selecione um ponto para abrir a câmera sem perder o contexto do local.</div>
          </div>
          <div className="flex h-9 items-center rounded-md border border-border bg-card p-1 text-xs">
            <button type="button" onClick={() => setMode('geographic')} className={`h-7 rounded px-3 ${mode === 'geographic' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>Mapa</button>
            <button type="button" onClick={() => setMode('floorplan')} className={`h-7 rounded px-3 ${mode === 'floorplan' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>Planta</button>
          </div>
          {mode === 'floorplan' && <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="h-9 rounded-md border border-border bg-card px-3 text-xs">
            {visibleSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>}
          {mode === 'floorplan' && <select value={floor} onChange={(e) => setFloor(e.target.value)} className="h-9 rounded-md border border-border bg-card px-3 text-xs">
            {(currentLayouts.length ? currentLayouts : [{ floor: 'Principal' }]).map((layout) => <option key={layout.floor} value={layout.floor}>{layout.floor}</option>)}
          </select>}
          {mode === 'floorplan' && role === 'admin' && (
            <button type="button" onClick={() => { setDraftMarkers(activeLayout?.markers ?? {}); setEditing((value) => !value); }} className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs hover:bg-accent">
              {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}{editing ? 'Cancelar edição' : 'Organizar mapa'}
            </button>
          )}
        </div>

        {error && <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}

        {mode === 'floorplan' && editing && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 p-2.5">
            <span className="px-1 text-xs text-muted-foreground">Escolha a câmera e clique no ponto da planta:</span>
            <select value={placingId} onChange={(e) => setPlacingId(e.target.value)} className="h-8 min-w-48 rounded border border-border bg-card px-2 text-xs">
              <option value="">Selecionar câmera…</option>
              {siteCameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}
            </select>
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded border border-border bg-card px-2.5 text-xs hover:bg-accent">
              <Upload className="h-3.5 w-3.5" /> Enviar planta SVG<input type="file" accept="image/svg+xml,.svg" className="hidden" onChange={(e) => uploadSvg(e.target.files?.[0])} />
            </label>
            <button type="button" disabled={saving} onClick={() => void saveLayout()} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"><Check className="h-3.5 w-3.5" />{saving ? 'Salvando…' : 'Salvar posições'}</button>
          </div>
        )}

        {mode === 'geographic' ? (
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
            <GeographicCameraMap cameras={cameras.filter((camera) => camera.enabled)} onOpen={openCamera} />
          </div>
        ) : <div ref={stageRef} onClick={placeMarker} className={`relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card ${editing && placingId ? 'cursor-crosshair' : ''}`}>
          {activeLayout?.svgDataUrl ? (
            <img src={activeLayout.svgDataUrl} alt={`Planta ${floor}`} className="absolute inset-0 h-full w-full object-fill opacity-80" />
          ) : (
            <div className="absolute inset-0 opacity-60" style={{ backgroundImage: 'linear-gradient(hsl(var(--border)/.45) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)/.45) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
          )}
          {!activeLayout?.svgDataUrl && <div className="absolute left-5 top-5 rounded-lg border border-border bg-card/90 px-3 py-2 backdrop-blur"><div className="text-xs font-medium">{visibleSites.find((site) => site.id === siteId)?.name ?? 'Unidade'}</div><div className="text-[10px] text-muted-foreground">Envie uma planta SVG ou use o mapa esquemático.</div></div>}
          {mappedCameras.map((camera) => {
            const marker = currentMarkers[camera.id];
            return <button key={camera.id} type="button" onClick={(e) => { e.stopPropagation(); editing ? setPlacingId(camera.id) : openCamera(camera); }} style={{ left: `${marker.xPct}%`, top: `${marker.yPct}%` }} className="group absolute z-10 -translate-x-1/2 -translate-y-1/2" title={camera.name}>
              <span className={`flex h-9 w-9 items-center justify-center rounded-full border-2 bg-card shadow-lg transition-transform group-hover:scale-110 ${camera.isOnline ? 'border-emerald-500 text-emerald-500' : 'border-muted-foreground text-muted-foreground'}`}><CameraIcon className="h-4 w-4" /></span>
              <span className="absolute left-1/2 top-10 max-w-40 -translate-x-1/2 whitespace-nowrap rounded bg-background/90 px-2 py-1 text-[10px] font-medium shadow-sm backdrop-blur">{camera.name}</span>
            </button>;
          })}
          {!mappedCameras.length && <div className="absolute inset-0 flex items-center justify-center"><div className="max-w-sm rounded-xl border border-border bg-card/95 p-5 text-center shadow-lg"><Layers3 className="mx-auto h-7 w-7 text-muted-foreground" /><div className="mt-3 text-sm font-medium">Nenhuma câmera nesta planta</div><div className="mt-1 text-xs text-muted-foreground">{siteCameras.length ? 'Use “Organizar mapa” para posicionar as câmeras desta unidade.' : 'A planta é opcional. Use o Mapa para visualizar todas as câmeras cadastradas.'}</div></div></div>}
        </div>}
      </section>

      <aside className="hidden w-64 shrink-0 border-l border-border bg-card/50 p-3 xl:block">
        <div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold">{mode === 'geographic' ? 'Todas as câmeras' : 'Câmeras da unidade'}</span><span className="text-[10px] text-muted-foreground">{mode === 'geographic' ? `${cameras.filter((camera) => camera.latitude != null && camera.longitude != null).length}/${cameras.length}` : `${mappedCameras.length}/${siteCameras.length}`}</span></div>
        <div className="space-y-1 overflow-y-auto">
          {(mode === 'geographic' ? cameras.filter((camera) => camera.enabled) : [...mappedCameras, ...unmappedCameras]).map((camera) => <button key={camera.id} onClick={() => mode === 'geographic' ? (camera.latitude != null && camera.longitude != null ? openCamera(camera) : setLocation(`/cameras?edit=${encodeURIComponent(camera.id)}`)) : (currentMarkers[camera.id] ? openCamera(camera) : (editing && setPlacingId(camera.id)))} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent">
            <span className={`h-2 w-2 rounded-full ${camera.isOnline ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} /><span className="min-w-0 flex-1"><span className="block truncate text-xs">{camera.name}</span>{mode === 'geographic' && <span className="block truncate text-[9px] text-muted-foreground">{camera.locationAddress || 'Definir endereço'}</span>}</span>{mode === 'geographic' ? (camera.latitude != null && camera.longitude != null ? <MapPin className="h-3 w-3 text-primary" /> : <Pencil className="h-3 w-3 text-muted-foreground" />) : currentMarkers[camera.id] ? <MapPin className="h-3 w-3 text-primary" /> : <Plus className="h-3 w-3 text-muted-foreground" />}
          </button>)}
        </div>
      </aside>

      {selected && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/45 p-4 backdrop-blur-[2px]" onClick={closeCamera}>
          <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-border px-4 py-3"><span className={`h-2.5 w-2.5 rounded-full ${selected.isOnline ? 'bg-emerald-500' : 'bg-muted-foreground'}`} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{selected.name}</div><div className="text-[10px] text-muted-foreground">{selected.zone} · {statusLabel(selected)}</div></div>{role !== 'viewer' && <Link href={`/cameras/${selected.id}`} className="hidden h-8 items-center gap-1.5 rounded border border-border px-2.5 text-xs hover:bg-accent sm:flex">Detalhes <ExternalLink className="h-3 w-3" /></Link>}<button onClick={closeCamera} className="flex h-8 w-8 items-center justify-center rounded hover:bg-accent" aria-label="Fechar câmera"><X className="h-4 w-4" /></button></div>
            <div className="relative aspect-video bg-black">{selected.isOnline ? <LiveStreamPlayer cameraId={selected.id} cameraName={selected.name} className="absolute inset-0 h-full w-full" muted showOverlay aiEnabled={selected.aiEnabled} liveViewMode="selected" /> : <div className="flex h-full items-center justify-center text-sm text-white/55">Câmera offline</div>}</div>
          </div>
        </div>
      )}
    </div>
  );
}
