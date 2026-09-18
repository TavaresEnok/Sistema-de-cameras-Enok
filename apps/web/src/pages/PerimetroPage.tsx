import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import axios from 'axios';
import { getApiBaseUrl } from '../lib/api-base';
import { perimeterState, type PerimeterProcessor } from '../lib/perimeter-state';
import { CameraEditSheet } from '../components/CameraEditSheet';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '../components/ui/alert-dialog';
import { useLocation } from 'wouter';
import { ShieldAlert, Spline, SquareDashed, EyeOff } from 'lucide-react';
import { SeletorDeCamera } from '../components/SeletorDeCamera';
import { IlustracaoPerimetro } from '../components/IlustracaoPerimetro';
import { DetectionZonesEditor, type DetectionZone } from '../components/DetectionZonesEditor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthStore } from '../store/authStore';
import { useVmsDataStore } from '../store/vmsDataStore';

// ── PÁGINA DE PERÍMETRO — linha e zona de detecção, por câmera ──────────────
//
// Você DESENHA aqui mesmo, sobre o SNAPSHOT da câmera (não o vídeo ao vivo): o
// snapshot é confiável (aparece mesmo com o streaming instável) e é a MESMA
// imagem que a detecção vê. Antes esta tela mostrava o player ao vivo, que
// ficava preto quando o stream falhava — e sem imagem não dá para desenhar.
//
// O que é cada coisa:
//   · Linha       — um limite que não se atravessa (tripwire), com sentido.
//   · Monitorar   — área onde a detecção vale.
//   · Ignorar     — área que a detecção descarta (galho, rua movimentada).

type ResumoPerimetro = { linhas: number; monitorar: number; ignorar: number };

function resumir(zones: Array<{ kind: string }> | undefined): ResumoPerimetro {
  const r: ResumoPerimetro = { linhas: 0, monitorar: 0, ignorar: 0 };
  for (const z of zones ?? []) {
    if (z.kind === 'line') r.linhas += 1;
    else if (z.kind === 'include') r.monitorar += 1;
    else if (z.kind === 'exclude') r.ignorar += 1;
  }
  return r;
}

const temPerimetro = (r: ResumoPerimetro) => r.linhas + r.monitorar + r.ignorar > 0;
const podeConfigurarPerimetro = (camera: { aiEnabled: boolean; recordingMode: string }) =>
  camera.aiEnabled || camera.recordingMode === 'motion' || camera.recordingMode === 'object';

export default function PerimetroPage() {
  const [location, setLocation] = useLocation();
  const userRole = useAuthStore((state) => state.user?.role ?? 'viewer');
  const cameras = useVmsDataStore((state) => state.cameras);
  const token = useAuthStore((state) => state.accessToken);
  const [processors, setProcessors] = useState<Record<string, PerimeterProcessor>>({});
  const [checked, setChecked] = useState(false);
  const [healthError, setHealthError] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(300);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  const saveThenLeave = useRef(false);
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const guard = (action: () => void) => {
    if (dirty) { pendingRef.current = action; setPending(() => action); }
    else { setTesting(false); action(); }
  };
  useEffect(() => {
    if (!token || userRole === 'viewer') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const { data } = await axios.get(`${getApiBaseUrl()}/ai/health`, { headers: { Authorization: `Bearer ${token}` }, timeout: 8000, signal: controller.signal });
        if (!cancelled) { setProcessors(data?.processors ?? {}); setChecked(true); setHealthError(false); }
      } catch { if (!cancelled) { setHealthError(true); setChecked(false); } }
      if (!cancelled) timer = setTimeout(poll, testing ? 2000 : 10000);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [token, userRole, testing]);
  useEffect(() => {
    if (!dirty) return;
    const intercept = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || event.ctrlKey || event.metaKey || anchor.target === '_blank' || anchor.origin !== window.location.origin || anchor.pathname === window.location.pathname) return;
      event.preventDefault(); event.stopPropagation();
      const action = () => setLocation(anchor.pathname + anchor.search + anchor.hash);
      pendingRef.current = action; setPending(() => action);
    };
    document.addEventListener('click', intercept, true);
    return () => document.removeEventListener('click', intercept, true);
  }, [dirty, setLocation]);

  // Estado local do resumo por câmera: começa do store e é atualizado quando o
  // editor salva, para a lista lateral refletir na hora sem recarregar tudo.
  const [zonasPorCamera, setZonasPorCamera] = useState<Record<string, DetectionZone[]>>({});
  const [groupFilter, setGroupFilter] = useState('__all__');
  useEffect(() => { setPage(0); }, [search, filter, groupFilter]);

  const lista = useMemo(
    () => cameras
      .filter((camera) => camera.enabled && podeConfigurarPerimetro(camera))
      .map((camera) => {
        const zonas = zonasPorCamera[camera.id]
          ?? (camera.detectionZones as DetectionZone[] | undefined)
          ?? [];
        return { camera, zonas, resumo: resumir(zonas) };
      })
      .sort((a, b) =>
        Number(temPerimetro(b.resumo)) - Number(temPerimetro(a.resumo))
        || Number(b.camera.isOnline) - Number(a.camera.isOnline)
        || a.camera.name.localeCompare(b.camera.name, 'pt-BR')),
    [cameras, zonasPorCamera],
  );
  const groupFilters = useMemo(
    () => ['__all__', ...Array.from(new Set(lista.map((item) => item.camera.floor).filter((group) => group && group !== '-')))],
    [lista],
  );
  const listaFiltrada = useMemo(
    () => groupFilter === '__all__' ? lista : lista.filter((item) => item.camera.floor === groupFilter),
    [groupFilter, lista],
  );

  const [selectedCamId, setSelectedCamId] = useState(() => {
    try { return sessionStorage.getItem('perimeter-selected-camera') ?? ''; } catch { return ''; }
  });
  useEffect(() => {
    try { if (selectedCamId) sessionStorage.setItem('perimeter-selected-camera', selectedCamId); } catch { /* Preferência opcional. */ }
  }, [selectedCamId]);
  const appliedRequest = useRef<string | null>(null);

  const requestedCameraId = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('cameraId');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  useEffect(() => {
    if (!listaFiltrada.length) { setSelectedCamId(''); return; }
    if (requestedCameraId && appliedRequest.current !== requestedCameraId && listaFiltrada.some((i) => i.camera.id === requestedCameraId)) {
      appliedRequest.current = requestedCameraId;
      setSelectedCamId((cur) => (cur === requestedCameraId ? cur : requestedCameraId));
      return;
    }
    if (!selectedCamId || !listaFiltrada.some((i) => i.camera.id === selectedCamId)) {
      setSelectedCamId(listaFiltrada[0].camera.id);
    }
  }, [listaFiltrada, requestedCameraId, selectedCamId]);

  const selecionada = listaFiltrada.find((i) => i.camera.id === selectedCamId) ?? null;
  const totalComPerimetro = listaFiltrada.filter((i) => temPerimetro(i.resumo)).length;
  const visible = listaFiltrada.filter(({ camera, resumo }) => camera.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')) &&
    (filter === 'all' || (filter === 'empty' ? !temPerimetro(resumo) : perimeterState(camera.isOnline, resumo.linhas > 0, processors[camera.id], checked).attention)));
  const pageCount = Math.max(1, Math.ceil(visible.length / 30));
  const currentPage = Math.min(page, pageCount - 1);
  const selectedState = selecionada ? perimeterState(selecionada.camera.isOnline, selecionada.resumo.linhas > 0, processors[selecionada.camera.id], checked) : null;

  // ── Sem nenhuma câmera ativa ────────────────────────────────────────────
  if (!lista.length) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="ops-card w-full max-w-lg overflow-hidden">
          <div className="border-b border-border px-8 py-6 text-center">
            <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-[hsl(var(--muted-foreground))]" />
            <h1 className="text-[17px] font-semibold">Nenhuma câmera ativa</h1>
            <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-muted-foreground">
              Nenhuma câmera ativa tem detecção de movimento ou objetos habilitada.
              Ative a análise ou a gravação por movimento em uma câmera para configurar o perímetro.
            </p>
            {/* Sem câmera, o lugar da imagem ficava vazio e ninguém entendia o
                que iria desenhar ali. O exemplo mostra o resultado antes de
                existir a primeira câmera. */}
            <div className="mx-auto mt-5 w-full max-w-sm overflow-hidden rounded-lg border border-border">
              <IlustracaoPerimetro className="block h-auto w-full" />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Assim ficará sobre a imagem da sua câmera.
            </p>
          </div>
          <div className="flex justify-center gap-2 px-8 py-4">
            <button type="button" onClick={() => setLocation('/live')} className="btn btn-secondary btn-sm">Voltar ao Ao Vivo</button>
            {userRole !== 'viewer' && (
              <button type="button" onClick={() => setLocation('/cameras')} className="btn btn-primary btn-sm">Ver câmeras</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Cabeçalho */}
      <div className="page-hdr flex-wrap gap-3">
        <div>
          <p className="page-sub">
            Desenhe a linha de travessia e as zonas sobre a imagem da câmera ·{' '}
            {totalComPerimetro} de {listaFiltrada.length} configurada(s)
          </p>
        </div>
        <div className="w-[min(100%,320px)]">
          <SeletorDeCamera
            cameras={listaFiltrada.map((item) => item.camera)}
            value={selectedCamId}
            onChange={(id) => guard(() => setSelectedCamId(id))}
            placeholder="Selecione uma câmera"
            className="h-10 w-full"
            vazio="Nenhuma câmera ativa."
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:grid lg:grid-cols-[minmax(0,1fr)_var(--perimeter-sidebar)]" style={{ '--perimeter-sidebar': `${width}px` } as CSSProperties}>
        {/* Editor: DESENHA aqui, sobre o snapshot da câmera */}
        <div className="min-w-0 shrink-0" ref={editorRef}>
          {selecionada && <div className="mb-4 rounded-xl border border-border p-4 space-y-2">
            <div className="flex flex-wrap justify-between gap-2"><h1 className="font-semibold">{selecionada.camera.name}</h1><span className={`text-xs ${selectedState?.attention || healthError ? 'text-amber-500' : 'text-muted-foreground'}`}>{healthError ? 'Não foi possível verificar a análise' : selectedState?.label}</span></div>
            <p className="text-xs text-muted-foreground">{selecionada.resumo.linhas} linha(s) · {selecionada.resumo.monitorar} área(s) monitorada(s) · {selecionada.resumo.ignorar} área(s) ignorada(s)</p>
            <p className="text-xs">Gravação: {({ continuous: 'contínua', motion: 'por movimento', object: 'por objeto', schedule: 'conforme programação', manual: 'somente manual' })[selecionada.camera.recordingMode]}. Alertas da câmera: {selecionada.camera.alarmsEnabled ? 'habilitados, conforme regras e permissões de notificação' : 'desligados'}.</p>
            <p className="text-xs text-muted-foreground">Objetos selecionados: {selecionada.camera.aiObjectClasses.map((c) => ({ person: 'Pessoas', car: 'Carros', motorcycle: 'Motos', bicycle: 'Bicicletas', bus: 'Ônibus', truck: 'Caminhões' } as Record<string, string>)[c] ?? c).join(', ') || 'nenhum'}. O desenho não ativa sozinho gravações ou alertas.</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-secondary btn-sm" disabled={dirty || !selecionada.zonas.length} title={dirty ? 'Salve ou descarte o desenho antes de testar' : undefined} onClick={() => setTesting(!testing)}>{testing ? 'Voltar a editar' : 'Testar perímetro'}</button>
              {userRole !== 'viewer' && <button className="btn btn-secondary btn-sm" onClick={() => guard(() => setEditing(true))}>Configurar detecção e ações</button>}
            </div>
          </div>}
          {selecionada && (
            <DetectionZonesEditor
              key={selecionada.camera.id}
              cameraId={selecionada.camera.id}
              cameraName={selecionada.camera.name}
              initialZones={selecionada.zonas}
              onDirtyChange={setDirty}
              readOnly={userRole === 'viewer' || testing}
              testing={testing}
              ignoredMotion={processors[selecionada.camera.id]?.motion_detector?.perimeter_ignored_motion}
              onSaved={(zones) => {
                setZonasPorCamera((prev) => ({ ...prev, [selecionada.camera.id]: zones }));
                setDirty(false);
                if (saveThenLeave.current) { saveThenLeave.current = false; setPending(null); setTesting(false); pendingRef.current?.(); pendingRef.current = null; }
              }}
            />
          )}
          {selecionada && !selecionada.camera.aiEnabled && (
            <p className="mt-3 rounded-lg border border-[hsl(var(--chart-4)_/_0.3)] bg-[hsl(var(--chart-4)_/_0.08)] px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              A IA está desligada no cadastro. O desenho salvo não confirma a detecção de travessia. Eventos próprios da câmera dependem do suporte e da configuração do equipamento.
            </p>
          )}
        </div>

        {/* Frota: quem já tem perímetro, quem não tem */}
        <aside className="relative flex min-h-0 shrink-0 flex-col lg:sticky lg:top-0 lg:max-h-[calc(100vh-160px)]">
          <div role="separator" aria-label="Ajustar largura da lista de câmeras" aria-orientation="vertical" aria-valuemin={240} aria-valuemax={520} aria-valuenow={width} tabIndex={0} className="absolute -left-3 top-0 bottom-0 hidden w-2 cursor-col-resize rounded bg-primary/30 hover:bg-primary/70 lg:block"
            onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setWidth((w) => Math.max(240, Math.min(520, w + (e.key === 'ArrowLeft' ? 20 : -20)))); } }}
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setWidth(Math.max(240, Math.min(520, e.currentTarget.parentElement!.getBoundingClientRect().right - e.clientX))); }} />
          <div className="mb-2 shrink-0 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">Câmeras</div>
            <input aria-label="Buscar câmera" placeholder="Buscar câmera…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs" />
            <Select value={groupFilter} onValueChange={(value) => guard(() => setGroupFilter(value))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos os grupos" /></SelectTrigger>
              <SelectContent>
                {groupFilters.map((group) => <SelectItem key={group} value={group} className="text-xs">{group === '__all__' ? 'Todos os grupos' : group}</SelectItem>)}
              </SelectContent>
            </Select>
            <select aria-label="Filtrar por situação" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-full rounded-lg border border-border bg-background p-2 text-xs"><option value="all">Todas as situações</option><option value="empty">Sem configuração</option><option value="attention">Precisam de atenção</option></select>
          </div>
          <div className="min-h-0 max-h-[420px] flex-1 space-y-1.5 overflow-y-auto pr-1 lg:max-h-none">
            {visible.slice(currentPage * 30, (currentPage + 1) * 30).map(({ camera, resumo }) => {
              const ativa = camera.id === selectedCamId;
              return (
                <button
                  key={camera.id}
                  type="button"
                  onClick={() => guard(() => setSelectedCamId(camera.id))}
                  title={camera.name}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                    ativa
                      ? 'border-[hsl(var(--primary)_/_0.5)] bg-[hsl(var(--primary)_/_0.08)]'
                      : 'border-border bg-background/55 hover:bg-background'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${camera.isOnline ? 'status-online' : 'status-offline'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium">{camera.name}</span>
                    <span className="block text-[10px] text-muted-foreground">{healthError ? 'Análise não verificada' : perimeterState(camera.isOnline, resumo.linhas > 0, processors[camera.id], checked).label}</span>
                    <span className="block text-[10px] text-[hsl(var(--muted-foreground))]">
                      {temPerimetro(resumo) ? <ResumoInline resumo={resumo} /> : 'sem perímetro'}
                    </span>
                  </span>
                  {!camera.aiEnabled && (
                    <span title="IA desligada nesta câmera">
                      <EyeOff className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                    </span>
                  )}
                </button>
              );
            })}
            {!visible.length && <p className="p-3 text-xs text-muted-foreground">Nenhuma câmera corresponde aos filtros.</p>}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs"><button className="btn btn-secondary btn-sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button><span>{currentPage + 1} / {pageCount} · {visible.length}</span><button className="btn btn-secondary btn-sm" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Próxima</button></div>

          {/* Legenda do que cada desenho significa */}
          <div className="mt-3 shrink-0 space-y-1.5 rounded-lg border border-border bg-background/40 p-3 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2"><Spline className="h-3.5 w-3.5" /> Linha — limite que não se atravessa</div>
            <div className="flex items-center gap-2"><SquareDashed className="h-3.5 w-3.5" /> Monitorar — onde a detecção vale</div>
            <div className="flex items-center gap-2"><EyeOff className="h-3.5 w-3.5" /> Ignorar — o que a detecção descarta</div>
          </div>
        </aside>
      </div>
      <CameraEditSheet camera={selecionada?.camera ?? null} open={editing} onClose={() => setEditing(false)} />
      <AlertDialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) { setPending(null); pendingRef.current = null; saveThenLeave.current = false; } }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Guardar seu desenho?</AlertDialogTitle><AlertDialogDescription>Há alterações não salvas. Se estiver desenhando uma área, conclua o desenho antes de salvar.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <button className="btn btn-secondary" onClick={() => { setPending(null); pendingRef.current = null; saveThenLeave.current = false; }}>Continuar editando</button>
            <button className="btn btn-secondary" onClick={() => { editorRef.current?.querySelector<HTMLButtonElement>('[data-perimeter-discard]')?.click(); setDirty(false); setPending(null); setTesting(false); pendingRef.current?.(); pendingRef.current = null; }}>Descartar</button>
            <button className="btn btn-primary" onClick={() => { const button = editorRef.current?.querySelector<HTMLButtonElement>('[data-perimeter-save]'); if (button && !button.disabled) { saveThenLeave.current = true; button.click(); } else { setPending(null); pendingRef.current = null; } }}>Salvar e continuar</button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ResumoInline({ resumo }: { resumo: ResumoPerimetro }) {
  const partes: string[] = [];
  if (resumo.linhas) partes.push(`${resumo.linhas} linha${resumo.linhas > 1 ? 's' : ''}`);
  if (resumo.monitorar) partes.push(`${resumo.monitorar} monitorar`);
  if (resumo.ignorar) partes.push(`${resumo.ignorar} ignorar`);
  return <>{partes.join(' · ')}</>;
}
