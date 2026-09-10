import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { CarFront, RefreshCw } from 'lucide-react';
import { getApiBaseUrl } from '../lib/api-base';
import { useAuthStore } from '../store/authStore';
import { getRequestErrorMessage } from '../lib/request-error';
import { toast } from '../hooks/use-toast';

type Summary = { available: boolean; maxCameras: number | null; enabledCameras: number; engine: string; engineMessage: string };
type Read = { id: string; plateNormalized: string; confidence: number; direction?: string | null; listKind?: string | null; occurredAt: string; camera: { name: string } };
type Camera = { id: string; name: string; plateRecognitionEnabled: boolean; plateRecognitionFps: number; plateRecognitionMinConfidence: number };

export default function PlateRecognitionPage() {
  const token = useAuthStore((s) => s.accessToken);
  const client = useMemo(() => axios.create({ baseURL: getApiBaseUrl(), headers: token ? { Authorization: `Bearer ${token}` } : undefined, timeout: 20000 }), [token]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reads, setReads] = useState<Read[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b, c] = await Promise.all([client.get<Summary>('/plate-recognition/summary'), client.get<Read[]>('/plate-recognition/reads'), client.get<Camera[]>('/plate-recognition/cameras')]);
      setSummary(a.data); setReads(b.data); setCameras(c.data); setError('');
    } catch (e) { setError(getRequestErrorMessage(e, 'Não foi possível carregar a leitura de placas.')); }
    finally { setLoading(false); }
  }, [client]);
  useEffect(() => { void load(); }, [load]);
  const toggle = async (camera: Camera) => {
    try {
      await client.patch(`/plate-recognition/cameras/${camera.id}`, { enabled: !camera.plateRecognitionEnabled });
      toast({ title: !camera.plateRecognitionEnabled ? 'Leitura de placas ativada' : 'Leitura de placas desativada', description: camera.name });
      void load();
    } catch (e) { toast({ title: 'Não foi possível alterar a câmera', description: getRequestErrorMessage(e, 'Verifique o limite contratado.'), variant: 'destructive' }); }
  };
  return <div className="flex h-full min-h-0 flex-col overflow-auto p-4 md:p-6">
    <div className="page-hdr flex items-center gap-3"><CarFront className="h-5 w-5 text-primary" /><div className="min-w-0 flex-1"><h1 className="page-title">Leitura de placas</h1><p className="page-sub">Entradas reconhecidas, listas operacionais e câmeras habilitadas.</p></div><button className="btn btn-secondary btn-sm" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> Atualizar</button></div>
    {error && <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    {summary && <div className="mt-4 grid gap-3 md:grid-cols-3"><div className="rounded-lg border bg-card p-4"><div className="text-xs text-muted-foreground">Câmeras habilitadas</div><strong className="text-2xl">{summary.enabledCameras}{summary.maxCameras !== null ? ` / ${summary.maxCameras}` : ''}</strong></div><div className="rounded-lg border bg-card p-4"><div className="text-xs text-muted-foreground">Recurso na instalação</div><strong>{summary.available ? 'Liberado pela Central' : 'Aguardando liberação da Central'}</strong></div><div className="rounded-lg border bg-card p-4"><div className="text-xs text-muted-foreground">Motor de reconhecimento</div><strong>{summary.engine === 'not_configured' ? 'Ainda não instalado' : summary.engine}</strong><p className="mt-1 text-xs text-muted-foreground">{summary.engineMessage}</p></div></div>}
    <section className="mt-5 rounded-lg border bg-card"><div className="border-b p-4"><h2 className="font-semibold">Câmeras</h2><p className="text-xs text-muted-foreground">Ative apenas os pontos de entrada e saída. A Central aplica o limite contratado.</p></div><div className="divide-y">{cameras.map((camera) => <div className="flex items-center gap-3 p-3" key={camera.id}><div className="min-w-0 flex-1"><strong className="text-sm">{camera.name}</strong><div className="text-xs text-muted-foreground">{camera.plateRecognitionFps} fps · confiança mínima {camera.plateRecognitionMinConfidence}%</div></div><button className={camera.plateRecognitionEnabled ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'} onClick={() => void toggle(camera)} disabled={!summary?.available}>{camera.plateRecognitionEnabled ? 'Ativada' : 'Ativar'}</button></div>)}{!loading && !cameras.length && <div className="p-5 text-sm text-muted-foreground">Nenhuma câmera disponível.</div>}</div></section>
    <section className="mt-5 rounded-lg border bg-card"><div className="border-b p-4"><h2 className="font-semibold">Últimas leituras</h2><p className="text-xs text-muted-foreground">O histórico aparecerá aqui após o motor OCR ser instalado e validado.</p></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="p-3">Placa</th><th className="p-3">Câmera</th><th className="p-3">Confiança</th><th className="p-3">Data</th></tr></thead><tbody>{reads.map((read) => <tr className="border-t" key={read.id}><td className="p-3 font-medium">{read.plateNormalized}</td><td className="p-3">{read.camera.name}</td><td className="p-3">{Math.round(read.confidence * 100)}%</td><td className="p-3">{new Date(read.occurredAt).toLocaleString('pt-BR')}</td></tr>)}{!loading && !reads.length && <tr><td className="p-5 text-muted-foreground" colSpan={4}>Nenhuma placa reconhecida ainda.</td></tr>}</tbody></table></div></section>
  </div>;
}
