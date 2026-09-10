import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import {
  Cpu, MemoryStick, HardDrive, Activity, Gauge, RefreshCw,
  Server, Video, Brain, ArrowUp, ArrowDown, Minus, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { getApiBaseUrl } from '@/lib/api-base';
import { useAuthStore } from '@/store/authStore';
import { useVmsDataStore } from '@/store/vmsDataStore';
import { toast } from '../hooks/use-toast';
import { formatarBytes } from '@/lib/formato';

const API_URL = getApiBaseUrl();
const HISTORY = 40; // samples in sparkline

type Sample = { cpu: number; ram: number; disk: number };

type OptimizationReport = {
  optimizationPlan?: { safeActionCount?: number; manualActionCount?: number; canApplySafely?: boolean };
  recommendations?: Array<{ code: string; severity: 'info' | 'warning' | 'critical'; message: string; action: string; cameras: string[] }>;
};

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return <div className="h-10" />;
  const w = 100, h = 40;
  const max = 100;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (Math.min(v, max) / max) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `0,${h} ${pts.join(' ')} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-10 w-full">
      <polygon points={area} fill={color} fillOpacity="0.12" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Trend({ now, prev }: { now: number; prev: number }) {
  const d = now - prev;
  if (Math.abs(d) < 1) return <span className="inline-flex items-center text-muted-foreground"><Minus className="h-3 w-3" /></span>;
  if (d > 0) return <span className="inline-flex items-center gap-0.5 text-[hsl(var(--status-warning))]"><ArrowUp className="h-3 w-3" />{Math.abs(d)}%</span>;
  return <span className="inline-flex items-center gap-0.5 text-[hsl(var(--status-online))]"><ArrowDown className="h-3 w-3" />{Math.abs(d)}%</span>;
}

function toneFor(pct: number) {
  if (pct >= 85) return 'hsl(var(--status-alarm))';
  if (pct >= 65) return 'hsl(var(--status-warning))';
  return 'hsl(var(--primary))';
}

function severityTone(s: 'info' | 'warning' | 'critical') {
  if (s === 'critical') return 'border-[hsl(var(--destructive)_/_0.35)] bg-[hsl(var(--destructive)_/_0.08)] text-[hsl(var(--destructive))]';
  if (s === 'warning') return 'border-[hsl(var(--status-warning)_/_0.35)] bg-[hsl(var(--status-warning)_/_0.10)] text-[hsl(var(--status-warning))]';
  return 'border-border bg-[hsl(var(--muted)_/_0.4)] text-muted-foreground';
}

/** Cor da pílula de estado da tabela de saúde por câmera (mesma paleta de severityTone). */
function friendlyRecommendation(recommendation: NonNullable<OptimizationReport['recommendations']>[number]) {
  const technicalText = `${recommendation.message} ${recommendation.action}`.toLowerCase();
  if (/opus|audio.*transcod|transcod.*audio/.test(technicalText)) {
    return {
      message: 'O áudio de algumas câmeras precisa de conversão para tocar no navegador.',
      action: 'Isso aumenta o consumo de processamento. Mantenha o áudio apenas onde ele for necessário.',
    };
  }
  return { message: recommendation.message, action: recommendation.action };
}

function fmtUptime(seconds?: number) {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function PerformancePage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const cameras = useVmsDataStore((s) => s.cameras);
  const system = useVmsDataStore((s) => s.system);
  const load = useVmsDataStore((s) => s.load);
  const isAdmin = user?.role === 'admin';

  const [history, setHistory] = useState<Sample[]>([]);
  const [aiHealth, setAiHealth] = useState<any>(null);
  const [report, setReport] = useState<OptimizationReport | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [auto, setAuto] = useState(true);
  const [applying, setApplying] = useState(false);
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const refreshRef = useRef(false);

  const cpu = system ? Math.min(100, Math.round(((system.server.loadAverage[0] ?? 0) / Math.max(system.server.cpuCount, 1)) * 100)) : 0;
  const ram = system ? Math.min(100, Math.round(((system.server.totalMemoryBytes - system.server.freeMemoryBytes) / Math.max(system.server.totalMemoryBytes, 1)) * 100)) : 0;
  const disk = system?.disk.usagePercent ?? 0;
  const onlineCams = cameras.filter((c) => c.isOnline).length;
  const aiCams = cameras.filter((c) => c.aiEnabled).length;
  const processors: Record<string, any> = aiHealth?.processors ?? {};
  const runningProc = Object.values(processors).filter((p: any) => p?.running).length;

  const refresh = async () => {
    if (refreshRef.current) return;
    refreshRef.current = true;
    setRefreshing(true);
    try {
      await load();
      if (accessToken) {
        const headers = { Authorization: `Bearer ${accessToken}` };
        const [healthRes, diagRes] = await Promise.all([
          axios.get(`${API_URL}/ai/health`, { headers }).catch(() => null),
          axios.get(`${API_URL}/camera-stream/resource-diagnostics`, { headers }).catch(() => null),
        ]);
        if (healthRes) setAiHealth(healthRes.data);
        if (diagRes) setReport(diagRes.data);
      }
    } finally {
      refreshRef.current = false;
      setRefreshing(false);
    }
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (!system) return;
    setHistory((prev) => [...prev, { cpu, ram, disk }].slice(-HISTORY));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system]);

  useEffect(() => {
    if (!auto) return;
    const t = window.setInterval(() => { void refresh(); }, 20000); // 20s: o ciclo dispara 3 requisições + load() da store
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, accessToken]);

  const applySafeOptimizations = async () => {
    if (!accessToken || !isAdmin || !report?.optimizationPlan?.canApplySafely) return;
    setConfirmApplyOpen(false);
    setApplying(true);
    try {
      await axios.post(`${API_URL}/camera-stream/optimization/apply-safe`, {}, { headers: { Authorization: `Bearer ${accessToken}` } });
      toast({ title: 'Ajustes seguros aplicados', description: 'O diagnóstico foi atualizado com a nova configuração.' });
      await refresh();
    } catch (err) {
      const message = axios.isAxiosError(err) ? (err.response?.data?.message ?? err.message) : 'Falha ao aplicar otimização segura.';
      toast({ title: 'Falha ao otimizar', description: Array.isArray(message) ? message.join(' | ') : String(message), variant: 'destructive' });
    } finally {
      setApplying(false);
    }
  };

  const cpuHist = history.map((h) => h.cpu);
  const ramHist = history.map((h) => h.ram);
  const diskHist = history.map((h) => h.disk);
  const prev = history.length > 1 ? history[history.length - 2] : { cpu, ram, disk };

  const load1 = system?.server.loadAverage[0] ?? 0;
  const totalRamGB = system ? (system.server.totalMemoryBytes / 1024 / 1024 / 1024).toFixed(1) : '0';
  const usedRamGB = system ? ((system.server.totalMemoryBytes - system.server.freeMemoryBytes) / 1024 / 1024 / 1024).toFixed(1) : '0';

  const METRICS = [
    { key: 'cpu', label: 'CPU', value: cpu, sub: `${system?.server.cpuCount ?? '—'} núcleos disponíveis`, hist: cpuHist, icon: Cpu },
    { key: 'ram', label: 'Memória', value: ram, sub: `${usedRamGB} / ${totalRamGB} GB`, hist: ramHist, icon: MemoryStick },
    { key: 'disk', label: 'Disco', value: disk, sub: system ? `${formatarBytes(system.disk.usedBytes)} de ${formatarBytes(system.disk.totalBytes)}` : '—', hist: diskHist, icon: HardDrive },
  ];

  const canApplySafely = isAdmin && Boolean(report?.optimizationPlan?.canApplySafely);
  const recommendations = report?.recommendations ?? [];

  return (
    // Mesma regra do contrato de rolagem: esta página é longa (3 cartões +
    // 4 indicadores + 2 tabelas por câmera) e seria cortada sem isto.
    <div className="h-full overflow-y-auto">
    <div className="p-4 md:p-6 space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Recursos do servidor e orientações para manter o sistema fluido.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canApplySafely && (
            <button
              onClick={() => setConfirmApplyOpen(true)}
              disabled={applying}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--primary)_/_0.35)] bg-[hsl(var(--primary)_/_0.08)] px-3 py-2 text-xs font-medium text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--primary)_/_0.14)] disabled:opacity-50"
            >
              <CheckCircle2 className={`h-3.5 w-3.5 ${applying ? 'animate-pulse' : ''}`} /> Ajustar seguro
              {report?.optimizationPlan?.safeActionCount ? ` (${report.optimizationPlan.safeActionCount})` : ''}
            </button>
          )}
          <button
            onClick={() => setAuto((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${auto ? 'border-[hsl(var(--primary)_/_0.35)] bg-[hsl(var(--primary)_/_0.08)] text-[hsl(var(--primary))]' : 'border-border bg-card text-muted-foreground hover:bg-accent'}`}
          >
            <Activity className="h-3.5 w-3.5" /> {auto ? 'Ao vivo' : 'Pausado'}
          </button>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium transition hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>
      </div>

      {/* ── Primary metrics ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {METRICS.map((m) => {
          const Icon = m.icon;
          const tone = toneFor(m.value);
          return (
            <div key={m.key} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-background border border-border">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </span>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{m.label}</div>
                    <div className="text-[10px] text-muted-foreground">{m.sub}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-semibold tabular-nums leading-none" style={{ color: tone }}>{m.value}<span className="text-base">%</span></div>
                  <div className="mt-1 text-[10px]"><Trend now={m.value} prev={(prev as any)[m.key]} /></div>
                </div>
              </div>
              <div className="mt-3"><Sparkline data={m.hist} color={tone} /></div>
            </div>
          );
        })}
      </div>

      {/* ── Secondary KPIs ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Streams ativos', value: `${onlineCams}/${cameras.length}`, icon: Video, hint: 'câmeras online' },
          { label: 'Processadores IA', value: `${runningProc}/${aiCams || 0}`, icon: Brain, hint: 'rodando / habilitados' },
          { label: 'Carga recente', value: `${load1.toFixed(1)} / ${system?.server.cpuCount ?? '—'}`, icon: Gauge, hint: 'trabalho atual em relação aos núcleos disponíveis', mono: true },
          { label: 'Uptime', value: fmtUptime(system?.server.uptimeSeconds), icon: Server, hint: system?.server.hostname ?? 'servidor' },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{k.label}</span>
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className={`mt-2 text-xl font-semibold ${k.mono ? 'font-mono text-lg' : ''}`}>{k.value}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">{k.hint}</div>
            </div>
          );
        })}
      </div>

      {/* ── Orientações de desempenho ── */}
      {recommendations.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border">
            <AlertTriangle className="h-4 w-4 text-[hsl(var(--primary))]" />
            <h2 className="text-[13px] font-semibold">Atenção ao desempenho</h2>
          </div>
          <div className="divide-y divide-border/60">
            {recommendations.map((r) => {
              const copy = friendlyRecommendation(r);
              return (
              <div key={r.code} className="px-5 py-3 space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${severityTone(r.severity)}`}>
                    {r.severity === 'critical' ? 'crítico' : r.severity === 'warning' ? 'atenção' : 'info'}
                  </span>
                  <span className="text-[12.5px] font-medium">{copy.message}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">{copy.action}</p>
                {r.cameras?.length ? <p className="truncate text-[10px] text-muted-foreground/80">{r.cameras.join(', ')}</p> : null}
              </div>
              );
            })}
          </div>
        </div>
      )}

      {!system && (
        <p className="text-center text-xs text-muted-foreground py-4">
          Aguardando métricas do servidor…
        </p>
      )}

      <AlertDialog open={confirmApplyOpen} onOpenChange={setConfirmApplyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar ajustes seguros de streaming?</AlertDialogTitle>
            <AlertDialogDescription>
              O S2Cam não vai alterar IP, senha, RTSP, ONVIF, codec físico da câmera ou áudio — apenas parâmetros de entrega/streaming considerados seguros.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void applySafeOptimizations()}>Aplicar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </div>
  );
}
